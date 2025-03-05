const Song = require("../models/Song"); // ✅ Import once
const { getLyricsFromGenius } = require("../services/geniusService");
const { fetchLyricsUrl } = require("../services/lyricsService"); // Import Genius search function
const { translateBatch, languageDetector } = require("../services/translationService"); // ✅ Import translation service with language detector
const axios = require("axios");
const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
const { analyzeSentiment } = require("../services/sentimentService");

// Optionally add an error listener to handle connection issues gracefully:
redis.on("error", (error) => {
  console.error("Redis error:", error);
});

// Use BACKEND_URL environment variable if available. Otherwise, we'll use the request's host.
const BACKEND_URL = process.env.BACKEND_URL;

// ✅ Log a new song (triggered by user action) and fetch the lyrics URL
const logSong = async (req, res) => {
  try {
    const { song, artist } = req.body;

    if (!song || !artist) {
      return res.status(400).json({ error: "Song and artist are required" });
    }

    console.log(`🎵 Logging song: ${song} by ${artist}`);

    // ✅ Check if song already exists in DB
    let existingSong = await Song.findOne({ song, artist });
    if (existingSong) {
      console.log("✅ Song already exists in history.");
      return res.json({ message: "Song already exists!", song: existingSong });
    }

    // ✅ Fetch Genius Lyrics URL
    console.log(`🔍 Searching for Genius lyrics URL for: ${song} by ${artist}`);
    const lyricsUrl = await fetchLyricsUrl(song, artist);

    if (!lyricsUrl) {
      return res.status(404).json({ error: "Lyrics URL not found." });
    }

    console.log(`✅ Found lyrics URL: ${lyricsUrl}`);

    // ✅ Store song in MongoDB
    const newSong = new Song({ song, artist, lyricsUrl });
    await newSong.save();

    // ✅ Delete Cache for This Song
    await redis.del(`flashcards:${song}`);
    console.log(`🗑️ Cleared cache for: ${song}`);

    res.json({ message: "Song logged successfully!", song: newSong });
  } catch (error) {
    console.error("❌ Error logging song:", error);
    res.status(500).json({ error: "Failed to log song." });
  }
};

// ✅ Get song history
const getSongHistory = async (req, res) => {
  try {
    const songs = await Song.find().sort({ timestamp: -1 });
    res.json(songs);
  } catch (error) {
    console.error("❌ Error fetching song history:", error);
    res.status(500).json({ error: "Failed to fetch history." });
  }
};

// ✅ Clear song history
const clearHistory = async (req, res) => {
  try {
    await Song.deleteMany({}); // 🗑️ Delete song history from MongoDB
    await redis.flushdb(); // 🔥 Clear ALL Redis cache (optional: limit scope)
    
    console.log("✅ History and Redis cache cleared on logout");

    res.json({ message: "History and cache cleared!" });
  } catch (error) {
    console.error("❌ Error clearing history:", error);
    res.status(500).json({ error: "Failed to clear history." });
  }
};


const getFlashcardsForSong = async (req, res) => {
  try {
    const songTitle = req.query.song;
    const forceLanguage = req.query.lang; // Optional override parameter
    const cacheKey = `flashcards:${songTitle}${forceLanguage ? ':' + forceLanguage : ''}`;

    // Check Redis cache first
    const cachedFlashcards = await redis.get(cacheKey);
    if (cachedFlashcards) {
      console.log(`⚡ Serving flashcards from cache for: ${songTitle}`);
      return res.json(JSON.parse(cachedFlashcards));
    }

    console.log(`🔎 Looking for song: ${songTitle}`);

    // Find song in the DB
    const song = await Song.findOne({ song: songTitle });
    if (!song || !song.lyricsUrl) {
      return res.status(404).json({ error: "Song not found in history" });
    }
    console.log(`✅ Found song in DB with lyrics URL: ${song.lyricsUrl}`);

    // Normalize BACKEND_URL to ensure it includes a protocol
    const normalizedBackendUrl = BACKEND_URL
      ? (BACKEND_URL.startsWith("http") ? BACKEND_URL : `https://${BACKEND_URL}`)
      : `${req.protocol}://${req.get('host')}`;

    // Fetch Lyrics from the Lyrics API
    const response = await fetch(
      `${normalizedBackendUrl}/api/lyrics/fetch-lyrics?lyricsUrl=${encodeURIComponent(song.lyricsUrl)}`
    );
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error(
        `Failed to fetch lyrics. Status: ${response.status}, Message: ${errorData}`
      );
      return res.status(500).json({ 
         error: "Failed to fetch lyrics from Genius", 
         details: errorData 
      });
    }
    
    const data = await response.json();

    if (!data.lyrics || data.lyrics.trim().length === 0) {
      return res.status(500).json({ error: "Failed to fetch lyrics from Genius" });
    }
    
    console.log("🔍 Raw Lyrics Received");

    // Process lyrics to remove section markers and handle special cases
    const lyricsLines = data.lyrics.split('\n')
      .map(line => {
        // Remove any section markers with or without quotes
        // This handles both "[Intro]" and ""[Intro]""
        const cleanLine = line.replace(/"?\[.*?\]"?/g, '').trim();
        return cleanLine;
      })
      // Only keep non-empty lines after section marker removal
      .filter(line => line.length > 0);
    
    console.log(`📝 Found ${lyricsLines.length} lyric lines after removing section markers`);

    // Prepare arrays for translation
    let frontLines = lyricsLines;
    
    // ===== OPTIMIZED TRANSLATION APPROACH =====
    // Deduplicate for efficient translation but keep all lines in final output
    
    // Step 1: Create a map of unique lines for translation efficiency
    const uniqueLines = new Map(); // Maps text to index in uniqueArray
    const uniqueArray = []; // Stores unique lyric lines
    const originalToUnique = new Map(); // Maps original position to unique line index
    
    // Identify unique lines while preserving all original lines
    frontLines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      if (!uniqueLines.has(trimmedLine)) {
        // New unique line found
        uniqueLines.set(trimmedLine, uniqueArray.length);
        uniqueArray.push(trimmedLine);
      }
      
      // Map this position to its corresponding unique line
      originalToUnique.set(index, uniqueLines.get(trimmedLine));
    });
    
    // Calculate and log translation optimization stats
    const totalLines = frontLines.length;
    const uniqueCount = uniqueArray.length;
    const savedLines = totalLines - uniqueCount;
    const percentSaved = Math.round((savedLines / totalLines) * 100);
    
    console.log(`🔍 Translation Optimization: ${totalLines} total lines → ${uniqueCount} unique lines to translate (saved ${percentSaved}% API usage)`);
    
    // Step 2: Automatically detect language from the combined lyrics
    // Use forceLanguage if explicitly provided in the request
    // A small sample of lyrics is enough for detection
    let detectedOrForcedLanguage = forceLanguage;
    if (!detectedOrForcedLanguage) {
      // Create a sample text for language detection (first 10 unique lines or fewer)
      const sampleText = uniqueArray.slice(0, Math.min(10, uniqueArray.length)).join(" ");
      detectedOrForcedLanguage = languageDetector.detectLanguage(sampleText);
      console.log(`🔤 Auto-detected language: ${detectedOrForcedLanguage}`);
    } else {
      console.log(`🔤 Using forced language: ${detectedOrForcedLanguage}`);
    }
    
    // Step 3: Translate only the unique lines in batches
    const BATCH_SIZE = 10; // Number of lines to translate in each API call
    const uniqueTranslations = [];
    
    // Process unique lines in batches
    for (let i = 0; i < uniqueArray.length; i += BATCH_SIZE) {
      const batch = uniqueArray.slice(i, i + BATCH_SIZE);
      console.log(`🔤 Translating unique batch ${Math.floor(i/BATCH_SIZE) + 1} (${batch.length} lines)`);
      
      // Send the batch for translation with the detected/forced language
      const translatedBatch = await translateBatch(batch, detectedOrForcedLanguage);
      
      // Add translated lines to unique translations array
      uniqueTranslations.push(...translatedBatch);
    }
    
    // Step 4: Map translations back to ALL original lines (including duplicates)
    const backLines = frontLines.map((_, index) => {
      // Get the unique line index for this position
      const uniqueIndex = originalToUnique.get(index);
      // Return the translation for this unique line
      return uniqueTranslations[uniqueIndex] || "Translation unavailable";
    });
    
    // Create flashcards with proper alignment, keeping ALL lines in order
    let flashcards = frontLines.map((line, index) => {
      return {
        front: line.trim(),
        // Extra cleaning to remove any potential artifact characters from translation
        back: backLines[index].trim().replace(/\|+/g, '').trim()
      };
    });
    
    // Track filtering statistics for debugging
    const initialCount = flashcards.length;
    let emptyCount = 0;
    let identicalCount = 0;
    let sectionMarkerCount = 0;
    
    // Track identical translations but keep them in the results
    flashcards.forEach(card => {
      if (card.front === card.back) {
        identicalCount++;
        // Optionally add a marker to the card
        card.isIdentical = true;
      }
    });

    // Final filter to ensure quality flashcards with detailed tracking
    flashcards = flashcards.filter(card => {
      // Check for empty front or back
      if (card.front.length === 0 || card.back.length === 0) {
        emptyCount++;
        return false;
      }
      
      // Check for section markers that might have slipped through
      if (/^\[.*\]$/.test(card.front) || /^\[.*\]$/.test(card.back)) {
        sectionMarkerCount++;
        return false;
      }
      
      return true;
    });

    // Log the count of identical translations (kept in the results)
    console.log(`📊 Found ${identicalCount} identical translations (kept in flashcards)`);
    
    // Log detailed filtering statistics
    const filteredCount = initialCount - flashcards.length;
    console.log(`✅ Created ${flashcards.length} clean flashcards from ${initialCount} lines (filtered ${filteredCount} problematic lines)`);
    
    if (filteredCount > 0) {
      console.log(`📊 Filtering breakdown: ${emptyCount} empty lines, ${identicalCount} identical translations (kept), ${sectionMarkerCount} section markers`);
    }
    
    // Cache the flashcards
    await redis.setex(cacheKey, 86400, JSON.stringify(flashcards));

    res.json(flashcards);
  } catch (error) {
    console.error("❌ Error fetching flashcards:", error);
    res.status(500).json({ error: "Failed to generate flashcards." });
  }
};

const deleteSong = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedSong = await Song.findByIdAndDelete(id);
    if (!deletedSong) {
      return res.status(404).json({ error: "Song not found" });
    }
    res.json({ message: "Song deleted successfully!" });
  } catch (error) {
    console.error("Error deleting song:", error);
    res.status(500).json({ error: "Failed to delete song." });
  }
};

// Updated getSongSentiment function to handle hybrid results
const getSongSentiment = async (req, res) => {
  try {
    const { song, artist } = req.query;
    
    if (!song) {
      return res.status(400).json({ error: "Song title is required" });
    }
    
    // Check Redis cache first if Redis is configured
    const cacheKey = `sentiment:${song}${artist ? ':' + artist : ''}`;
    let cachedSentiment;
    
    try {
      // Only try to get from cache if Redis is configured
      if (global.redisClient) {
        cachedSentiment = await global.redisClient.get(cacheKey);
      }
    } catch (cacheError) {
      console.log("Cache check failed, proceeding without cache");
    }
    
    if (cachedSentiment) {
      console.log(`⚡ Serving sentiment analysis from cache for: ${song}`);
      return res.json(JSON.parse(cachedSentiment));
    }
    
    // Find the song's flashcards
    let flashcards;
    try {
      // Try to get flashcards from the existing endpoint
      const flashcardsUrl = `${req.protocol}://${req.get('host')}/api/songs/flashcards?song=${encodeURIComponent(song)}${artist ? '&artist=' + encodeURIComponent(artist) : ''}`;
      const response = await fetch(flashcardsUrl);
      
      if (!response.ok) {
        console.error(`Failed to fetch flashcards: ${response.status} ${response.statusText}`);
        return res.status(500).json({ error: "Failed to fetch flashcards for sentiment analysis" });
      }
      
      flashcards = await response.json();
    } catch (flashcardsError) {
      console.error("Error fetching flashcards:", flashcardsError);
      return res.status(500).json({ 
        error: "Failed to retrieve flashcards for sentiment analysis",
        details: flashcardsError.message 
      });
    }
    
    if (!flashcards || !Array.isArray(flashcards) || flashcards.length === 0) {
      return res.status(404).json({ error: "No flashcards found for this song" });
    }
    
    // Extract all lyrical content for enhanced analysis
    const originalLyrics = flashcards.map(card => card.front).join("\n");
    const englishTranslations = flashcards.map(card => card.back).join("\n");
    
    // Create context-rich input for sentiment analysis
    // Format: English translations followed by key song metadata
    const contextualInput = `${englishTranslations}\n\nSong: ${song}\nArtist: ${artist || "Unknown"}`;
    
    console.log(`🔍 Starting enhanced sentiment analysis for song: "${song}" with ${flashcards.length} lines`);
    
    // Analyze sentiment with API-only approach
    let sentimentResult;
    try {
      sentimentResult = await analyzeSentiment(contextualInput);
      console.log(`✅ Enhanced sentiment analysis for "${song}": ${sentimentResult.sentiment} / ${sentimentResult.primaryEmotion || 'Unknown'}`);
      
      // Add detail about music context if available
      if (sentimentResult.musicContext) {
        console.log(`🎵 Musical emotion context: ${sentimentResult.musicContext}`);
      }
    } catch (sentimentError) {
      console.error(`❌ CRITICAL: Sentiment analysis failed for "${song}":`, sentimentError);
      
      // Provide a default sentiment when API fails
      sentimentResult = {
        sentiment: "Neutral",
        emoji: "😐",
        score: "0.50",
        emotions: [],
        primaryEmotion: "Unknown",
        emotionScore: "0.00",
        error: "Analysis service unavailable",
        fallback: true
      };
      console.log(`⚠️ Using emergency neutral fallback for "${song}"`);
    }
    
    // Add song metadata
    sentimentResult.songMetadata = {
      title: song,
      artist: artist || "Unknown Artist",
      lineCount: flashcards.length
    };
    
    // Cache the sentiment result for 7 days if Redis is available
    try {
      if (global.redisClient) {
        await global.redisClient.setex(cacheKey, 604800, JSON.stringify(sentimentResult));
        console.log(`💾 CACHED enhanced sentiment result for: "${song}"`);
      }
    } catch (cacheError) {
      console.log(`❌ Failed to cache sentiment result for "${song}":`, cacheError.message);
    }
    
    res.json(sentimentResult);
  } catch (error) {
    console.error("Error analyzing song sentiment:", error);
    res.status(500).json({ 
      error: "Failed to analyze song sentiment",
      fallback: {
        sentiment: "Unknown",
        emoji: "❓",
        score: "0.00",
        emotions: [],
        primaryEmotion: "Unknown",
        emotionScore: "0.00"
      }
    });
  }
};

// ✅ Ensure all functions are correctly exported
module.exports = { logSong, getSongHistory, clearHistory, getFlashcardsForSong, deleteSong, getSongSentiment };