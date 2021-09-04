import { model, Schema } from "mongosteel"

export type user = {
    username: string,
    password: string,
    maxMb: number,
    submitted: string[],
    id: string,
    admin: boolean
}
const userSH = new Schema<user>({
    id: "string",
    maxMb: "number",
    username: "string",
    submitted: ["string"],
    password: "string",
    admin: "boolean"
})

export const UserModel = model('users', userSH, { })

export default UserModel