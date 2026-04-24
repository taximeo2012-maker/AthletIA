import { GoogleGenAI } from "@google/genai";

/**
 * Executes an AI call with automatic retries for rate limits (429).
 * Note: This follows the @google/genai SDK pattern.
 */
export async function generateContentWithRetry(ai: GoogleGenAI, config: any, maxRetries = 5) {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      // The @google/genai SDK uses ai.models.generateContent
      const response = await ai.models.generateContent(config);
      return response;
    } catch (error: any) {
      lastError = error;
      
      // Extract error message potentially hidden in the response or thrown directly
      const errorMsg = error.message || (error.error?.message) || "";
      const errorStr = JSON.stringify(error).toUpperCase();
      
      const isRateLimit = errorMsg.includes("429") || 
                         errorMsg.includes("RESOURCE_EXHAUSTED") || 
                         errorMsg.includes("high demand") ||
                         errorStr.includes("429") ||
                         errorStr.includes("RESOURCE_EXHAUSTED") ||
                         errorStr.includes("QUOTA") ||
                         error.status === 429;

      if (isRateLimit) {
        console.warn(`AI model high demand, retry ${i + 1}/${maxRetries}...`);
        // Exponential backoff: 3s, 6s, 12s...
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 3000));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}
