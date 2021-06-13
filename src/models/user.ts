import { model, Model, Schema } from "mongoose";


export interface UserSH {
    username: string,
    password: string,
    maxMb: number,
    submitted: string[],
    id: string
}

export const UserSchema = new Schema<UserSH, Model<UserSH>, UserSH>({
    id: "string",
    maxMb: "number",
    username: "string",
    submitted: ["string"],
    password: "string"
})

export const userModel = model('users', UserSchema)

export interface AuthorMapSH {
    id: string,
    gif: boolean
    author: string,
    timestamp: number
}

export const AuthorSchema = new Schema<AuthorMapSH, Model<AuthorMapSH>, AuthorMapSH>({
    id: "string",
    author: "string",
    timestamp: "number",
    // todo gif
})

export const authorModel:Model<AuthorMapSH> = model('storageMap', AuthorSchema)