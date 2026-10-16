/**
 * Embedding & Semantic Vector Search Helper
 * Uses Google Gemini gemini-embedding-001 (100% Free)
 */

export async function getEmbedding(text: string): Promise<number[] | null> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) return null;

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: {
                        parts: [{ text: text.slice(0, 4000) }]
                    }
                })
            }
        );

        if (!res.ok) {
            console.warn("Embedding API returned status:", res.status);
            return null;
        }

        const data = await res.json();
        return data.embedding?.values || null;
    } catch (err) {
        console.error("Error generating embedding:", err);
        return null;
    }
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dot / magnitude;
}
