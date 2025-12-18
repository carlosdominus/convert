import { GoogleGenAI, Type } from "@google/genai";

export const analyzeImage = async (
  base64Data: string, 
  mimeType: string
): Promise<{ description: string; tags: string[] }> => {
  try {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.warn("API Key missing, skipping AI analysis");
      return { description: "AI Analysis unavailable (Missing Key)", tags: [] };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // Using gemini-2.5-flash for speed and vision capabilities
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType
            }
          },
          {
            text: "Analyze this image. Provide a short, professional description (max 20 words) suitable for file metadata, and a list of 5 relevant keyword tags."
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            tags: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["description", "tags"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");

    return JSON.parse(text);

  } catch (error) {
    console.error("Gemini Analysis Failed:", error);
    return { description: "Analysis failed", tags: [] };
  }
};