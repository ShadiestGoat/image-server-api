import { model, Schema } from "mongosteel"

export type submition = {
    id: string,
    gif: boolean
    author: string,
    timestamp: number,
    content: Buffer
}

const authorSH = new Schema<submition>({
    id: "string",
    author: "string",
    timestamp: "number",
    content: "mixed",
    gif: "boolean"
})

export const SubmittionModel = model('submittions', authorSH, { })

export default SubmittionModel