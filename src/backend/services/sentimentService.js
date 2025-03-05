const axios = require("axios");
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const HUGGINGFACE_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const MAX_TEXT_LENGTH = 2000; // Increased to capture more context

// Mapping of raw emotion labels to sentiment information.
const EMOTION_TO_SENTIMENT_MAP = {
  admiration: { sentiment: "Positive", score: 0.7 },
  amusement: { sentiment: "Positive", score: 0.8 },
  approval: { sentiment: "Positive", score: 0.7 },
  caring: { sentiment: "Positive", score: 0.6 },
  desire: { sentiment: "Positive", score: 0.6 },
  excitement: { sentiment: "Very Positive", score: 0.9 },
  gratitude: { sentiment: "Very Positive", score: 0.9 },
  joy: { sentiment: "Very Positive", score: 0.9 },
  love: { sentiment: "Very Positive", score: 0.9 },
  optimism: { sentiment: "Positive", score: 0.7 },
  pride: { sentiment: "Positive", score: 0.7 },
  relief: { sentiment: "Positive", score: 0.6 },
  curiosity: { sentiment: "Neutral", score: 0.5 },
  realization: { sentiment: "Neutral", score: 0.5 },
  surprise: { sentiment: "Neutral", score: 0.5 },
  neutral: { sentiment: "Neutral", score: 0.5 },
  anger: { sentiment: "Very Negative", score: 0.9 },
  annoyance: { sentiment: "Negative", score: 0.7 },
  confusion: { sentiment: "Neutral", score: 0.4 },
  disappointment: { sentiment: "Negative", score: 0.7 },
  disapproval: { sentiment: "Negative", score: 0.6 },
  disgust: { sentiment: "Very Negative", score: 0.8 },
  embarrassment: { sentiment: "Negative", score: 0.6 },
  fear: { sentiment: "Very Negative", score: 0.8 },
  grief: { sentiment: "Very Negative", score: 0.9 },
  nervousness: { sentiment: "Negative", score: 0.6 },
  remorse: { sentiment: "Negative", score: 0.7 },
  sadness: { sentiment: "Very Negative", score: 0.8 }
};

const SENTIMENT_TO_EMOJI = {
  "Very Positive": "😄",
  Positive: "🙂",
  Neutral: "😐",
  Negative: "😕",
  "Very Negative": "😞"
};

// Enhanced emotion mapping with music-specific nuance
const MUSIC_EMOTION_MAP = {
  // Positive emotions in musical context
  admiration: { musicContext: "Uplifting", weight: 1.2 },
  amusement: { musicContext: "Playful", weight: 1.0 },
  approval: { musicContext: "Affirming", weight: 1.0 },
  caring: { musicContext: "Comforting", weight: 1.1 },
  desire: { musicContext: "Yearning", weight: 1.3 }, // Amplified in music
  excitement: { musicContext: "Energetic", weight: 1.4 },
  gratitude: { musicContext: "Grateful", weight: 1.0 },
  joy: { musicContext: "Jubilant", weight: 1.3 },
  love: { musicContext: "Romantic", weight: 1.5 }, // Strong weight in music
  optimism: { musicContext: "Hopeful", weight: 1.2 },
  pride: { musicContext: "Triumphant", weight: 1.1 },
  relief: { musicContext: "Reassuring", weight: 1.0 },
  
  // Neutral emotions with music-specific nuance
  curiosity: { musicContext: "Questioning", weight: 1.0 },
  realization: { musicContext: "Enlightening", weight: 1.0 },
  surprise: { musicContext: "Unexpected", weight: 1.1 },
  neutral: { musicContext: "Reflective", weight: 0.8 },
  
  // Negative emotions in musical context
  anger: { musicContext: "Intense", weight: 1.3 },
  annoyance: { musicContext: "Frustrated", weight: 1.0 },
  confusion: { musicContext: "Uncertain", weight: 0.9 },
  disappointment: { musicContext: "Disheartened", weight: 1.1 },
  disapproval: { musicContext: "Critical", weight: 1.0 },
  disgust: { musicContext: "Repulsed", weight: 1.0 },
  embarrassment: { musicContext: "Awkward", weight: 0.8 },
  fear: { musicContext: "Anxious", weight: 1.2 },
  grief: { musicContext: "Mournful", weight: 1.4 }, // Amplified in ballads
  nervousness: { musicContext: "Tense", weight: 1.1 },
  remorse: { musicContext: "Regretful", weight: 1.2 },
  sadness: { musicContext: "Melancholic", weight: 1.5 } // Strong weight in music
};

// Update mapping to English labels (this will be used to display emotion labels in the result).
const EMOTION_TRANSLATIONS = {
  admiration: "Admiration",
  amusement: "Amusement",
  anger: "Anger",
  annoyance: "Annoyance",
  approval: "Approval",
  caring: "Caring",
  confusion: "Confusion",
  curiosity: "Curiosity",
  desire: "Desire",
  disappointment: "Disappointment",
  disapproval: "Disapproval",
  disgust: "Disgust",
  embarrassment: "Embarrassment",
  excitement: "Excitement",
  fear: "Fear",
  gratitude: "Gratitude",
  grief: "Grief",
  joy: "Joy",
  love: "Love",
  nervousness: "Nervousness",
  optimism: "Optimism",
  pride: "Pride",
  realization: "Realization",
  relief: "Relief",
  remorse: "Remorse",
  sadness: "Sadness",
  surprise: "Surprise",
  neutral: "Neutral"
};

// Music-specific stopwords to improve lyric analysis
const MUSIC_STOPWORDS = [
  'oh', 'ah', 'yeah', 'la', 'na', 'da', 'ba', 'hey', 'ooh', 'whoa', 'uh',
  'hmm', 'mmm', 'boom', 'yo', 'ay', 'yah', 'woo', 'skrrt'
];

/**
 * Identify song structure components (verse, chorus, bridge)
 * by detecting repetition patterns in lyrics
 * 
 * @param {Array} lines - Array of lyric lines
 * @returns {Object} Detected song structure
 */
const analyzeSongStructure = (lines) => {
  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    return { chorus: [], verses: [], bridge: [] };
  }
  
  try {
    // Clean and normalize lines for comparison
    const cleanedLines = lines.map(line => 
      line.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .trim()
    ).filter(line => line.length > 0);
    
    // Skip structural analysis if too few lines
    if (cleanedLines.length < 4) {
      return { 
        chorus: [], 
        verses: cleanedLines, 
        bridge: [],
        structureFound: false
      };
    }
    
    // Count line occurrences to find repeated sections (potential chorus)
    const lineOccurrences = {};
    cleanedLines.forEach(line => {
      if (line.length < 3) return; // Skip very short lines
      
      // Skip common musical fillers
      if (MUSIC_STOPWORDS.some(word => line === word)) return;
      
      lineOccurrences[line] = (lineOccurrences[line] || 0) + 1;
    });
    
    // Identify potential chorus lines (repeated 2+ times)
    const potentialChorusLines = Object.entries(lineOccurrences)
      .filter(([line, count]) => count >= 2 && line.length > 10) // Filter for meaningful lines
      .map(([line]) => line);
    
    // If we found potential chorus lines
    if (potentialChorusLines.length > 0) {
      // Find their original indices to locate chorus blocks
      const chorusIndices = [];
      potentialChorusLines.forEach(chorusLine => {
        cleanedLines.forEach((line, index) => {
          if (line === chorusLine) {
            chorusIndices.push(index);
          }
        });
      });
      
      // Sort indices to find adjacent chorus lines
      chorusIndices.sort((a, b) => a - b);
      
      // Group adjacent indices to identify chorus blocks
      const chorusBlocks = [];
      let currentBlock = [chorusIndices[0]];
      
      for (let i = 1; i < chorusIndices.length; i++) {
        if (chorusIndices[i] === chorusIndices[i-1] + 1) {
          // Adjacent line, add to current block
          currentBlock.push(chorusIndices[i]);
        } else {
          // Non-adjacent, start new block if current is valid
          if (currentBlock.length >= 2) { // Minimum 2 lines for chorus
            chorusBlocks.push([...currentBlock]);
          }
          currentBlock = [chorusIndices[i]];
        }
      }
      
      // Add the last block if valid
      if (currentBlock.length >= 2) {
        chorusBlocks.push(currentBlock);
      }
      
      // Find the most repeated block (likely the main chorus)
      let mainChorus = [];
      if (chorusBlocks.length > 0) {
        // Simple heuristic: take the longest block that appears multiple times
        mainChorus = chorusBlocks.reduce((longest, current) => 
          current.length > longest.length ? current : longest, []);
      }
      
      // Extract chorus, verse, and potential bridge
      const chorus = mainChorus.map(idx => lines[idx]);
      
      // Everything else is verses, except potential bridge
      const nonChorusIndices = [...Array(lines.length).keys()]
        .filter(i => !mainChorus.includes(i));
      
      // Simple bridge detection (typically in latter part of song)
      const lastThird = Math.floor(lines.length * 2/3);
      const potentialBridgeIndices = nonChorusIndices.filter(i => 
        i >= lastThird && 
        i + 1 < lines.length && 
        nonChorusIndices.includes(i + 1) // Adjacent non-chorus lines
      );
      
      // Take up to 4 consecutive lines as bridge if found
      const bridge = potentialBridgeIndices.length >= 2 ? 
        potentialBridgeIndices.slice(0, 4).map(idx => lines[idx]) : [];
      
      // Remaining lines are verses
      const verses = nonChorusIndices
        .filter(i => !potentialBridgeIndices.includes(i))
        .map(idx => lines[idx]);
      
      return {
        chorus,
        verses,
        bridge,
        structureFound: true,
        chorusWeight: mainChorus.length / lines.length // Relative chorus importance
      };
    } else {
      // No clear chorus pattern found
      return { 
        chorus: [], 
        verses: cleanedLines, 
        bridge: [],
        structureFound: false
      };
    }
  } catch (error) {
    console.error("Error analyzing song structure:", error);
    return { chorus: [], verses: lines, bridge: [], structureFound: false };
  }
};

/**
 * Enhance emotional context by analyzing song structure components separately
 * and weighting them appropriately (chorus typically carries more emotional weight)
 * 
 * @param {Object} songStructure - Song structure data
 * @param {Array} emotions - Raw emotion predictions 
 * @returns {Array} Enhanced emotions with musical context
 */
const enhanceEmotionalContext = (songStructure, emotions) => {
  // If no clear structure or no emotions, return unchanged
  if (!songStructure.structureFound || !emotions || emotions.length === 0) {
    return emotions;
  }
  
  try {
    // Apply structure-based weights to emotions
    const enhancedEmotions = emotions.map(emotion => {
      // Get music-specific context if available
      const musicContext = MUSIC_EMOTION_MAP[emotion.emotion] || { weight: 1.0 };
      
      // Apply chorus-based weighting (chorus is emotionally emphasized in songs)
      const chorusWeight = songStructure.chorusWeight || 0.3;
      const structureWeight = 1 + (chorusWeight * 0.5); // Boost based on chorus prominence
      
      // Calculate enhanced score with both music context and structure weights
      const enhancedScore = emotion.score * musicContext.weight * structureWeight;
      
      return {
        ...emotion,
        score: Math.min(enhancedScore, 1.0), // Cap at 1.0
        musicContext: musicContext.musicContext || null
      };
    });
    
    // Re-sort based on enhanced scores
    return enhancedEmotions.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("Error enhancing emotional context:", error);
    return emotions;
  }
};

/**
 * Preprocess song lyrics for sentiment analysis
 * Applies music-specific preprocessing to improve analysis
 */
const preprocessLyrics = (lyrics) => {
  // Handle empty input
  if (!lyrics) return "";
  
  try {
    // Normalize line endings and convert to array for structure analysis
    const lines = lyrics
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    // Analyze song structure
    const songStructure = analyzeSongStructure(lines);
    
    // Clean lyrics for sentiment analysis
    const cleanedLyrics = lines.map(line => {
      // Remove music-specific filler words/sounds
      let cleaned = line;
      MUSIC_STOPWORDS.forEach(word => {
        // Remove the word if it appears as a standalone term
        const wordRegex = new RegExp(`\\b${word}\\b`, 'gi');
        cleaned = cleaned.replace(wordRegex, '');
      });
      
      return cleaned.trim();
    }).filter(line => line.length > 0);
    
    // Emphasize chorus (which often contains the song's emotional core)
    // by repeating it in the input if detected
    let processedText = "";
    
    if (songStructure.structureFound && songStructure.chorus.length > 0) {
      // Add each verse once
      if (songStructure.verses.length > 0) {
        processedText += songStructure.verses.join(" ") + " ";
      }
      
      // Add chorus with emphasis (repeat it)
      processedText += songStructure.chorus.join(" ") + " ";
      
      // Add it again to emphasize its importance
      processedText += songStructure.chorus.join(" ") + " ";
      
      // Add bridge if present
      if (songStructure.bridge.length > 0) {
        processedText += songStructure.bridge.join(" ");
      }
    } else {
      // No clear structure detected, use cleaned lyrics
      processedText = cleanedLyrics.join(" ");
    }
    
    return {
      processedText: processedText.trim(),
      songStructure
    };
  } catch (error) {
    console.error("Error preprocessing lyrics:", error);
    return { processedText: lyrics, songStructure: null };
  }
};

/**
 * Process emotion results with enhanced music context
 */
const processEmotionResults = (results, songStructure = null) => {
  // Map the results to an array of { emotion, score } objects.
  const emotions = results
    .map(result => ({
      emotion: result.label,
      score: result.score !== undefined ? result.score : 0
    }))
    .filter((emotion, index, array) => {
      // For 'neutral', only include it if it's the only label or if its confidence is very high.
      if (emotion.emotion === "neutral") {
        const otherEmotions = array.filter(e => e.emotion !== "neutral");
        return otherEmotions.length === 0 || emotion.score > 0.7;
      }
      return true;
    })
    .sort((a, b) => b.score - a.score);

  // Add music-specific context if available and enhance weights based on song structure
  const enhancedEmotions = songStructure ? 
    enhanceEmotionalContext(songStructure, emotions) : emotions;
  
  // Get the primary emotion
  const primaryEmotion = enhancedEmotions.length > 0 ? 
    enhancedEmotions[0] : { emotion: "neutral", score: 1.0 };
    
  // Map to sentiment
  const sentimentInfo = EMOTION_TO_SENTIMENT_MAP[primaryEmotion.emotion] || 
    { sentiment: "Neutral", score: 0.5 };

  // Format displayed emotions
  const displayedEmotions = enhancedEmotions.slice(0, 3).map(item => ({
    emotion: EMOTION_TRANSLATIONS[item.emotion] || item.emotion,
    score: item.score ? item.score.toFixed(2) : "0.00",
    musicContext: item.musicContext || null
  }));

  return {
    sentiment: sentimentInfo.sentiment,
    emoji: SENTIMENT_TO_EMOJI[sentimentInfo.sentiment] || "😐",
    score: sentimentInfo.score.toFixed(2),
    emotions: displayedEmotions,
    primaryEmotion: EMOTION_TRANSLATIONS[primaryEmotion.emotion] || primaryEmotion.emotion,
    emotionScore: primaryEmotion.score ? primaryEmotion.score.toFixed(2) : "0.00",
    musicContext: primaryEmotion.musicContext || null,
    fallback: false
  };
};

/**
 * Connect to Hugging Face API for sentiment analysis
 */
const performSentimentAnalysis = async (text) => {
  const HUGGINGFACE_API_URL = "https://api-inference.huggingface.co/models/SamLowe/roberta-base-go_emotions";
  let attempts = 0;

  while (attempts < MAX_RETRY_ATTEMPTS) {
    try {
      console.log(`🔍 HUGGINGFACE API: Making sentiment request (attempt ${attempts + 1})...`);

      const response = await axios.post(
        HUGGINGFACE_API_URL,
        { inputs: text },
        {
          headers: {
            Authorization: `Bearer ${HUGGINGFACE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
          // Don't automatically parse HTML as JSON
          transformResponse: [(data) => {
            // Check if the response is HTML
            if (typeof data === 'string' && (data.includes('<!DOCTYPE html>') || data.includes('<html'))) {
              throw new Error('Received HTML error page from Hugging Face API');
            }
            // Try to parse as JSON
            try {
              return JSON.parse(data);
            } catch (e) {
              return data;
            }
          }],
        }
      );

      console.log("HUGGINGFACE API RESPONSE:", response.data);

      let predictions = [];
      // First check if the first element is an array.
      if (response.data && Array.isArray(response.data[0])) {
        predictions = response.data[0];
      } else if (Array.isArray(response.data)) {
        predictions = response.data;
      } else {
        throw new Error("Unexpected response format from Hugging Face API.");
      }

      if (predictions.length > 0) {
        return predictions;
      }

      console.log("⚠️ HUGGINGFACE API: Received empty predictions array.");
      return null;
    } catch (error) {
      attempts++;
      
      // Check for HTML in error response or error message
      const isHtmlError = 
        (error.message && error.message.includes('HTML error page')) ||
        (error.response && 
         typeof error.response.data === 'string' && 
         (error.response.data.includes('<html') || error.response.data.includes('<!DOCTYPE html>')));
        
      const statusCode = error.response ? error.response.status : "undefined";
      
      if (isHtmlError) {
        console.error(`❌ HUGGINGFACE API: Received HTML error page with status ${statusCode}`);
        
        // Always retry HTML errors, especially for 503 status
        if (attempts < MAX_RETRY_ATTEMPTS) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempts - 1);
          console.log(`⏱️ HUGGINGFACE API: HTML error received. Retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
      } else {
        console.error(
          `❌ HUGGINGFACE API: Attempt ${attempts} failed with status ${statusCode}:`,
          error.response ? error.response.data : error.message
        );
      }

      // Always retry when we get 503 Service Unavailable
      if (error.response && error.response.status === 503) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempts - 1);
        console.log(`⏱️ HUGGINGFACE API: Service Unavailable (503). Retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      if (
        attempts >= MAX_RETRY_ATTEMPTS ||
        (error.response && ![429, 500, 502, 503, 504].includes(error.response.status))
      ) {
        break;
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempts - 1);
      console.log(`⏱️ HUGGINGFACE API: Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  
  // If we reached max attempts or failed with non-retriable error, return fallback sentiment
  console.log("⚠️ HUGGINGFACE API: All attempts failed, using fallback sentiment analysis");
  return null;
};

/**
 * Create fallback response when API fails
 */
const createFallbackResponse = (errorMessage) => {
  return {
    sentiment: "Neutral",
    emoji: "😐",
    score: "0.50",
    emotions: [],
    primaryEmotion: "Unknown",
    emotionScore: "0.00",
    error: errorMessage,
    fallback: true
  };
};

/**
 * Enhanced sentiment analysis for song lyrics
 * Includes music-specific preprocessing and context
 */
const analyzeSentiment = async (text) => {
  if (!HUGGINGFACE_API_TOKEN) {
    console.error("❌ HUGGINGFACE API: Token is not configured");
    return createFallbackResponse("API token not configured");
  }

  try {
    // Enhanced preprocessing specifically for song lyrics
    console.log(`🎵 Preprocessing song lyrics for sentiment analysis...`);
    const { processedText, songStructure } = preprocessLyrics(text);
    
    // Truncate if necessary, preserving most relevant parts
    const truncatedText = processedText.length > MAX_TEXT_LENGTH ? 
      processedText.substring(0, MAX_TEXT_LENGTH) : processedText;
    
    // Log structure analysis results if found
    if (songStructure && songStructure.structureFound) {
      console.log(`✅ Song structure detected: ${songStructure.chorus.length} chorus lines, ${songStructure.verses.length} verse lines`);
      if (songStructure.chorusWeight) {
        console.log(`📊 Chorus prominence: ${Math.round(songStructure.chorusWeight * 100)}%`);
      }
    }
    
    // Call the API for sentiment analysis
    const predictions = await performSentimentAnalysis(truncatedText);

    if (predictions) {
      // Process results with enhanced music context
      const analysisResult = processEmotionResults(predictions, songStructure);
      console.log(`✅ API: Sentiment and emotion analysis successful`);
      
      // Add structure info to result if available
      if (songStructure && songStructure.structureFound) {
        analysisResult.songStructureAnalyzed = true;
        // Add musical context description if available for primary emotion
        if (analysisResult.musicContext) {
          analysisResult.musicDescription = 
            `This ${analysisResult.musicContext} song conveys ${analysisResult.primaryEmotion.toLowerCase()} emotions`;
        }
      }
      
      return analysisResult;
    }
    
    console.log(`❌ API: Sentiment and emotion analysis failed, using fallback`);
    return createFallbackResponse("Analysis service unavailable");
  } catch (error) {
    console.error("❌ Error in sentiment analysis:", error);
    return createFallbackResponse("Sentiment analysis failed");
  }
};

module.exports = { analyzeSentiment };