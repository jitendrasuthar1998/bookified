'use server';

import {CreateBook, TextSegment} from "@/types";
import {connectToDatabase} from "@/database/mongoose";
import {escapeRegex, generateSlug, serializeData} from "@/lib/utils";
import Book from "@/database/models/book.model";
import BookSegment from "@/database/models/book-segment.model";
import mongoose from "mongoose";
import {getUserPlan} from "@/lib/subscription.server";

export const getAllBooks = async (search?: string) => {
    try {
        await connectToDatabase();

        let query = {};

        if (search) {
            const escapedSearch = escapeRegex(search);
            const regex = new RegExp(escapedSearch, 'i');
            query = {
                $or: [
                    { title: { $regex: regex } },
                    { author: { $regex: regex } },
                ]
            };
        }

        const books = await Book.find(query).sort({ createdAt: -1 }).lean();

        return {
            success: true,
            data: serializeData(books)
        }
    } catch (e) {
        console.error('Error connecting to database', e);
        return {
            success: false, error: e
        }
    }
}

export const checkBookExists = async (title: string) => {
    try {
        await connectToDatabase();

        const slug = generateSlug(title);

        const existingBook = await Book.findOne({slug}).lean();

        if(existingBook) {
            return {
                exists: true,
                book: serializeData(existingBook)
            }
        }

        return {
            exists: false,
        }
    } catch (e) {
        console.error('Error checking book exists', e);
        return {
            exists: false, error: e
        }
    }
}

export const createBook = async (data: CreateBook) => {
    try {
        await connectToDatabase();

        const slug = generateSlug(data.title);

        const existingBook = await Book.findOne({slug}).lean();

        if(existingBook) {
            return {
                success: true,
                data: serializeData(existingBook),
                alreadyExists: true,
            }
        }

        // Todo: Check subscription limits before creating a book
        const { getUserPlan } = await import("@/lib/subscription.server");
        const { PLAN_LIMITS } = await import("@/lib/subscription-constants");

        const { auth } = await import("@clerk/nextjs/server");
        const { userId } = await auth();

        if (!userId || userId !== data.clerkId) {
            return { success: false, error: "Unauthorized" };
        }

        const plan = await getUserPlan();
        const limits = PLAN_LIMITS[plan];

        const bookCount = await Book.countDocuments({ clerkId: userId });

        if (bookCount >= limits.maxBooks) {
            const { revalidatePath } = await import("next/cache");
            revalidatePath("/");

            return {
                success: false,
                error: `You have reached the maximum number of books allowed for your ${plan} plan (${limits.maxBooks}). Please upgrade to add more books.`,
                isBillingError: true,
            };
        }

        const book = await Book.create({...data, clerkId: userId, slug, totalSegments: 0});

        return {
            success: true,
            data: serializeData(book),
        }
    } catch (e) {
        console.error('Error creating a book', e);

        return {
            success: false,
            error: e,
        }
    }
}

export const getBookBySlug = async (slug: string) => {
    try {
        await connectToDatabase();

        const book = await Book.findOne({ slug }).lean();

        if (!book) {
            return { success: false, error: 'Book not found' };
        }

        return {
            success: true,
            data: serializeData(book)
        }
    } catch (e) {
        console.error('Error fetching book by slug', e);
        return {
            success: false, error: e
        }
    }
}

export const saveBookSegments = async (bookId: string, clerkId: string, segments: TextSegment[]) => {
    try {
        await connectToDatabase();

        const { getEmbedding } = await import("@/lib/embedding");

        // Generate vector embeddings for segments
        const segmentsToInsert = await Promise.all(
            segments.map(async ({ text, segmentIndex, pageNumber, wordCount }) => {
                let embedding: number[] | undefined;
                try {
                    const emb = await getEmbedding(text);
                    if (emb && emb.length > 0) embedding = emb;
                } catch {}
                return {
                    clerkId,
                    bookId,
                    content: text,
                    segmentIndex,
                    pageNumber,
                    wordCount,
                    embedding,
                };
            })
        );

        await BookSegment.insertMany(segmentsToInsert);

        await Book.findByIdAndUpdate(bookId, { totalSegments: segments.length });

        console.log('Book segments with vector embeddings saved successfully.');

        return {
            success: true,
            data: { segmentsCreated: segments.length}
        }
    } catch (e) {
        console.error('Error saving book segments', e);

        return {
            success: false,
            error: e,
        }
    }
}

// Searches book segments using Semantic Vector Search with MongoDB text/regex fallback
export const searchBookSegments = async (bookId: string, query: string, limit: number = 5) => {
    try {
        await connectToDatabase();
        const bookObjectId = new mongoose.Types.ObjectId(bookId);

        // 1. Try Semantic Vector Search (Cosine Similarity)
        const { getEmbedding, cosineSimilarity } = await import("@/lib/embedding");
        const queryEmbedding = await getEmbedding(query);

        if (queryEmbedding) {
            const allSegments = await BookSegment.find({ bookId: bookObjectId })
                .select('_id bookId content segmentIndex pageNumber wordCount embedding')
                .lean();

            // If segments have embeddings, rank by cosine similarity
            const segmentsWithEmbeddings = allSegments.filter((s: any) => s.embedding && s.embedding.length > 0);

            if (segmentsWithEmbeddings.length > 0) {
                const scored = segmentsWithEmbeddings.map((s: any) => ({
                    ...s,
                    similarity: cosineSimilarity(queryEmbedding, s.embedding),
                }));

                scored.sort((a: any, b: any) => b.similarity - a.similarity);
                const topResults = scored.slice(0, limit);

                return {
                    success: true,
                    data: serializeData(topResults),
                };
            }
        }

        // 2. Fallback: MongoDB text search first (requires text index)
        let segments: Record<string, unknown>[] = [];
        try {
            segments = await BookSegment.find({
                bookId: bookObjectId,
                $text: { $search: query },
            })
                .select('_id bookId content segmentIndex pageNumber wordCount')
                .sort({ score: { $meta: 'textScore' } })
                .limit(limit)
                .lean();
        } catch {
            segments = [];
        }

        // 3. Fallback: regex search matching ANY keyword
        if (segments.length === 0) {
            const keywords = query.split(/\s+/).filter((k) => k.length > 2);
            const pattern = keywords.map(escapeRegex).join('|');

            segments = await BookSegment.find({
                bookId: bookObjectId,
                content: { $regex: pattern || query, $options: 'i' },
            })
                .select('_id bookId content segmentIndex pageNumber wordCount')
                .sort({ segmentIndex: 1 })
                .limit(limit)
                .lean();
        }

        return {
            success: true,
            data: serializeData(segments),
        };
    } catch (error) {
        console.error('Error searching segments:', error);
        return {
            success: false,
            error: (error as Error).message,
            data: [],
        };
    }
};

export const getChatHistory = async (bookId: string, clerkId: string) => {
    try {
        await connectToDatabase();
        const ChatMessage = (await import("@/database/models/chat-message.model")).default;
        const messages = await ChatMessage.find({ bookId, clerkId })
            .sort({ createdAt: 1 })
            .limit(50)
            .lean();

        return {
            success: true,
            data: serializeData(messages.map((m: any) => ({ role: m.role, content: m.content }))),
        };
    } catch (e) {
        console.error("Error fetching chat history:", e);
        return { success: false, data: [] };
    }
};
