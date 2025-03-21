const axios = require("axios");
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const HUGGINGFACE_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const MAX_TEXT_LENGTH = 1500; // Character limit for initial truncation
const MAX_TOKEN_LIMIT = 512;  // Hard token limit for the Hugging Face model

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

/**
 * Estimates the number of tokens in a text string
 * This is a simple approximation - actual tokenization depends on the model
 * 
 * @param {string} text - The text to estimate tokens for
 * @returns {number} - Estimated token count
 */
const estimateTokenCount = (text) => {
  // Simple estimate: average English word is ~4 characters + space
  // This gives us approximately 1 token per 4-5 characters
  // A more accurate approach would use proper tokenization
  return Math.ceil(text.length / 4);
};

/**
 * Truncates text to stay under the token limit
 * 
 * @param {string} text - Text to truncate
 * @returns {string} - Truncated text
 */
const truncateToTokenLimit = (text) => {
  if (!text) return "";
  
  // First apply the character limit as a quick filter
  let truncatedText = text.length > MAX_TEXT_LENGTH ? 
    text.substring(0, MAX_TEXT_LENGTH) : text;
  
  // Then check if we're still over the token limit
  let estimatedTokens = estimateTokenCount(truncatedText);
  
  if (estimatedTokens <= MAX_TOKEN_LIMIT) {
    return truncatedText;
  }
  
  // If we're over the token limit, truncate further
  // Calculate roughly how many characters we need to remove
  const excessTokens = estimatedTokens - MAX_TOKEN_LIMIT;
  const charsToRemove = excessTokens * 4; // Approximate
  
  // Apply a safety margin by removing a bit more than strictly necessary
  const safeCharsToKeep = truncatedText.length - charsToRemove - 20;
  
  // Truncate to the safe limit and add ellipsis
  return truncatedText.substring(0, Math.max(100, safeCharsToKeep)) + "...";
};

const processEmotionResults = (results) => {
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

  const primaryEmotion = emotions.length > 0 ? emotions[0] : { emotion: "neutral", score: 1.0 };
  const sentimentInfo = EMOTION_TO_SENTIMENT_MAP[primaryEmotion.emotion] || { sentiment: "Neutral", score: 0.5 };

  const displayedEmotions = emotions.slice(0, 3).map(item => ({
    emotion: EMOTION_TRANSLATIONS[item.emotion] || item.emotion,
    score: item.score ? item.score.toFixed(2) : "0.00"
  }));

  return {
    sentiment: sentimentInfo.sentiment,
    emoji: SENTIMENT_TO_EMOJI[sentimentInfo.sentiment] || "😐",
    score: sentimentInfo.score.toFixed(2),
    emotions: displayedEmotions,
    primaryEmotion: EMOTION_TRANSLATIONS[primaryEmotion.emotion] || primaryEmotion.emotion,
    emotionScore: primaryEmotion.score ? primaryEmotion.score.toFixed(2) : "0.00",
    fallback: false
  };
};

const performSentimentAnalysis = async (text) => {
  const HUGGINGFACE_API_URL = "https://api-inference.huggingface.co/models/SamLowe/roberta-base-go_emotions";
  let attempts = 0;

  while (attempts < MAX_RETRY_ATTEMPTS) {
    try {
      console.log(`🔍 HUGGINGFACE API: Making sentiment request (attempt ${attempts + 1})...`);
      console.log(`📊 Text length: ${text.length} chars, estimated tokens: ${estimateTokenCount(text)}`);

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
        return processEmotionResults(predictions);
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
  return {
    sentiment: "Neutral",
    emoji: "😐",
    score: "0.50",
    emotions: [],
    primaryEmotion: "Unknown",
    emotionScore: "0.00",
    error: "Sentiment analysis service unavailable",
    fallback: true
  };
};

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

const analyzeSentiment = async (text) => {
  if (!HUGGINGFACE_API_TOKEN) {
    console.error("❌ HUGGINGFACE API: Token is not configured");
    return createFallbackResponse("API token not configured");
  }

  // Apply token-aware truncation
  const truncatedText = truncateToTokenLimit(text);
  console.log(`✂️ Truncated text from ${text.length} chars to ${truncatedText.length} chars (token limit: ${MAX_TOKEN_LIMIT})`);
  
  const analysisResult = await performSentimentAnalysis(truncatedText);

  if (analysisResult) {
    console.log(`✅ API: Sentiment and emotion analysis successful`);
    return analysisResult;
  }
  
  console.log(`❌ API: Sentiment and emotion analysis failed, using fallback`);
  return createFallbackResponse("Analysis service unavailable");
};

module.exports = { analyzeSentiment };