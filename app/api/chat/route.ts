import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { searchBookSegments } from "@/lib/actions/book.actions";
import Book from "@/database/models/book.model";
import { connectToDatabase } from "@/database/mongoose";

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { bookId, message, history, persona } = body;

        if (!bookId || !message) {
            return NextResponse.json({ error: "Missing bookId or message" }, { status: 400 });
        }

        await connectToDatabase();
        const book = await Book.findById(bookId).lean();
        const bookTitle = book?.title || "this book";
        const bookAuthor = book?.author || "the author";

        // 1. Search relevant segments from MongoDB
        const searchResult = await searchBookSegments(bookId, message, 3);
        const segments = searchResult.data || [];
        const excerptText = segments
            .map((s: any) => s.content)
            .join("\n\n")
            .slice(0, 3000); // Keep reasonable context length

        const geminiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

        // 2. If Gemini API key is available, use Gemini 2.0 Flash
        if (geminiKey) {
            const systemPrompt = `You are the interactive conversational voice of the book "${bookTitle}" by ${bookAuthor}.
The user is speaking to you directly.
Guidelines:
- Keep your answer short, natural, and conversational (2-3 sentences, maximum 45 words) because your response will be spoken aloud via text-to-speech.
- Never use bullet points, asterisks, bolding, markdown formatting, or emojis.
- Rely on the book excerpts provided below. If the information isn't in the excerpts, answer based on general knowledge of "${bookTitle}".
- Adopt a warm, engaging tone matching the persona: ${persona || "friendly companion"}.`;

            const prompt = `Book Excerpts:\n${excerptText || "No specific excerpt found."}\n\nUser Question: ${message}`;

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{ text: systemPrompt }]
                        },
                        contents: [
                            ...(history || []).slice(-4).map((h: any) => ({
                                role: h.role === "assistant" ? "model" : "user",
                                parts: [{ text: h.content }]
                            })),
                            {
                                role: "user",
                                parts: [{ text: prompt }]
                            }
                        ],
                        generationConfig: {
                            maxOutputTokens: 120,
                            temperature: 0.7,
                        }
                    })
                }
            );

            if (response.ok) {
                const data = await response.json();
                const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (reply) {
                    return NextResponse.json({ reply: reply.trim() });
                }
            } else {
                console.warn("Gemini API call returned status:", response.status);
            }
        }

        // 3. Fallback if no Gemini key or API issue: Smart excerpt-based conversational response
        if (segments.length > 0) {
            const firstSnippet = (segments[0].content as string).slice(0, 220).replace(/\s+/g, ' ').trim();
            const reply = `According to ${bookTitle}, "${firstSnippet}..." What specific detail would you like to explore further?`;
            return NextResponse.json({ reply });
        }

        return NextResponse.json({
            reply: `I searched ${bookTitle} for "${message}", but couldn't find a direct match. Could you rephrase your question or ask about another chapter?`
        });
    } catch (error) {
        console.error("Chat API error:", error);
        return NextResponse.json({ error: "Failed to process chat message" }, { status: 500 });
    }
}
