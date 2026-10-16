import { model, Schema, models, Types, Document } from "mongoose";

export interface IChatMessage extends Document {
    clerkId: string;
    bookId: Types.ObjectId;
    role: "user" | "assistant";
    content: string;
    createdAt: Date;
    updatedAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>(
    {
        clerkId: { type: String, required: true, index: true },
        bookId: { type: Schema.Types.ObjectId, ref: "Book", required: true, index: true },
        role: { type: String, enum: ["user", "assistant"], required: true },
        content: { type: String, required: true },
    },
    { timestamps: true }
);

ChatMessageSchema.index({ clerkId: 1, bookId: 1, createdAt: 1 });

const ChatMessage = models.ChatMessage || model<IChatMessage>("ChatMessage", ChatMessageSchema);

export default ChatMessage;
