import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { searchBookSegments } from "@/lib/actions/book.actions";
import Book from "@/database/models/book.model";
import ChatMessage from "@/database/models/chat-message.model";
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

        // 1. Save incoming user message to persistent DB
        await ChatMessage.create({
            clerkId: userId,
            bookId,
            role: "user",
            content: message,
        });

        const book = await Book.findById(bookId).lean();
        const bookTitle = book?.title || "this book";
        const bookAuthor = book?.author || "the author";

        // 2. Perform Semantic / Keyword Search on book segments
        const searchResult = await searchBookSegments(bookId, message, 4);
        const segments = searchResult.data || [];
        const excerptText = segments
            .map((s: any) => s.content)
            .join("\n\n")
            .slice(0, 3500);

        const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;

        let reply = "";

        // 3. Call Google Gemini 2.5 Flash
        if (geminiKey) {
            const systemPrompt = `You are the interactive conversational voice companion for the book "${bookTitle}" by ${bookAuthor}.
The user is speaking directly to you via voice.
Persona style: ${persona || "engaging, warm, and thoughtful"}.

Core Rules:
1. Speak naturally like a knowledgeable, warm friend in a book club having an engaging conversation.
2. Provide a satisfying, complete, and helpful answer (3 to 5 full sentences). Explain facts, benefits, or recipe steps thoroughly and naturally so the listener gets real value. Never leave thoughts incomplete.
3. If the user is just responding casually (e.g. "yes first time", "hi", "how are you"), warmly welcome them and invite them to explore a topic from the book.
4. When asked about recipes, facts, summaries, or benefits, use the provided Book Excerpts to give accurate, detailed information.
5. NEVER output markdown symbols (no asterisks, no hashes, no bullet points, no bolding) and no emojis, because your response is converted directly to audio speech.`;

            // Prepare conversation turns for multi-turn memory
            const contents: any[] = [];

            // Add previous conversation turns
            const pastMessages = (history || []).slice(-6);
            for (const h of pastMessages) {
                if (h.content && h.role) {
                    contents.push({
                        role: h.role === "assistant" ? "model" : "user",
                        parts: [{ text: h.content }],
                    });
                }
            }

            // Current prompt with retrieved context
            const userPrompt = `[Context from "${bookTitle}"]:\n${excerptText || "No direct excerpt found."}\n\n[User Spoke]: "${message}"`;
            contents.push({
                role: "user",
                parts: [{ text: userPrompt }],
            });

            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            systemInstruction: {
                                parts: [{ text: systemPrompt }],
                            },
                            contents,
                            generationConfig: {
                                maxOutputTokens: 600,
                                temperature: 0.7,
                                thinkingConfig: {
                                    thinkingBudget: 0,
                                },
                            },
                        }),
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        // Strip any rogue markdown formatting, bullets, or odd line breaks for clean audio reading
                        reply = text
                            .replace(/[*_#`~]/g, "")
                            .replace(/^[\s•\-\*]+\s*/gm, "")
                            .replace(/\n+/g, " ")
                            .replace(/\s+/g, " ")
                            .trim();
                    }
                } else {
                    const errData = await response.text();
                    console.warn("Gemini 2.5 API error:", response.status, errData);
                }
            } catch (apiErr) {
                console.error("Gemini fetch exception:", apiErr);
            }
        }

        // 4. Fallback if Gemini unavailable
        if (!reply) {
            if (segments.length > 0) {
                const snippet = (segments[0].content as string).slice(0, 200).replace(/\s+/g, " ").trim();
                reply = `According to ${bookTitle}, ${snippet}. What specific part would you like to hear more about?`;
            } else {
                reply = `I searched ${bookTitle} for that, but didn't find a direct mention. Would you like me to summarize the main theme or explore a recipe?`;
            }
        }

        // 5. Save assistant reply to persistent DB
        await ChatMessage.create({
            clerkId: userId,
            bookId,
            role: "assistant",
            content: reply,
        });

        return NextResponse.json({ reply });
    } catch (error) {
        console.error("Chat API error:", error);
        return NextResponse.json({ error: "Failed to process chat message" }, { status: 500 });
    }
}
