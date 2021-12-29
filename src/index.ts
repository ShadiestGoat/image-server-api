import dotenv from "dotenv"
import { MongoSteel } from "mongosteel"
import express, { Application, NextFunction, Request, Response } from "express";
import fileUpload from "express-fileupload";
import cors from "cors";
import { randomBytes } from "crypto"
import sharp from "sharp"
import { compare, genSalt, hash } from "bcrypt";
import { SubmittionModel, submition } from "./models/submittion"
import { UserModel, user } from "./models/user"
import { Server } from "socket.io";

dotenv.config()
;[ "DB_NAME", "LOCATION", "PASSWORD", "USERNAME" ].forEach(element => {
    if (!process.env[element]) throw console.warn(`${element} is not present in env! Using default...`)
});

const { DB_NAME, LOCATION, PASSWORD, USERNAME } = process.env;

async function init2():Promise<void> {
    await MongoSteel.connect({
        dbName: DB_NAME ?? 'imgs',
        location: LOCATION ?? 'location:27017',
        password: PASSWORD ?? "admin",
        user: USERNAME ?? "admin",
        dbOpts: {
            readPreference: "primary",
            authSource: DB_NAME ?? 'imgs',
        }
    })
    ;(await SubmittionModel.find({})).forEach((val) => {submittionCache[val.id] = val})
    ;(await UserModel.find({})).forEach((val) => {userCache[val.id] = val;if (val.admin) admin[val.id] = val})
}

init2().then(() => console.log('Cache setup!')).catch(err => console.error(err))

const PORT = process.env.PORT ?? 3000;

const submittionCache:Record<string, submition> = {}
const userCache:Record<string, user> = {}
const admin:Record<string, user> = {}

const app:Application = express()
app.use(fileUpload({createParentPath: true}));
app.use(cors({origin: '*', }));
app.use(express.json());
app.use(express.urlencoded({extended: true}));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err:unknown, _req:Request, res:Response, _next:NextFunction) => {res.send({err: err});console.error(err)})
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use(async (err:unknown, _req:Request, res:Response, _next:NextFunction) => {res.send({err: err});console.error(err)})

app.get('/rawi/:id', async (req:Request<{id:string}>, res) => {
    const { id } = getIdInfo(req.params.id)
    const raw = submittionCache[id]
    if (!raw) throw 'notFound'
    res.send(raw.content.buffer)
})

function idMaker(mode:"user" | "img"):string {
    let id = randomBytes(32).toString('hex')
    if (Object.keys(mode == "user" ? userCache : submittionCache).includes(id)) {id = idMaker(mode)}
    return id
}

function authorize(id:string, password:string):user {
    const usr = userCache[id]
    if (!usr) throw 'Not Authorized'
    compare(password, usr.password, (err, success) => {
        if (err) throw err
        if (success) return usr
        else throw 'Not Authorized'
    })
    return usr
}

function getIdInfo(id:string):{
    format: string,
    id: string
} {
    const defaultFormat = 'webp'
    const format = id.split('.').pop() == id ? defaultFormat : !id.split('.').pop() ? defaultFormat : id.split('.').pop() ?? defaultFormat
    let newId = id + (new RegExp(`.${format}`).test(id) ? '' : `.${format}`)
    if (['gif', 'webp'].includes(format)) newId = newId.substr(0, newId.length - format.length - 1)
    return {
        format,
        id: newId
    }
}

app.delete('/i/:id', async (req:Request<{id: string}>, res) => {
    const auth = authorize(req.headers.id as string, req.headers.password as string)
    if (auth.id != req.headers.id) throw 'Not Authorized'
    await SubmittionModel.findOneAndDelete({id: req.params.id})
    delete submittionCache[req.params.id]
    userCache[auth.id].submitted.splice(userCache[auth.id].submitted.indexOf(req.params.id), 1)
    userCache[auth.id].submitted[userCache[auth.id].submitted.indexOf(req.params.id)] = userCache[auth.id].submitted[userCache[auth.id].submitted.length-1];
    userCache[auth.id].submitted.pop();
    await UserModel.findOneAndUpdate({id: auth.id}, {submitted: userCache[auth.id].submitted})
})

app.post('/upload', async (req, res) => {
    let usr:user;
    try {
        if (req.body.id && req.body.password) usr = authorize(req.body.id, req.body.password)
        else {res.sendStatus(401);return}
    } catch (err) {res.sendStatus(401);return}
    if (req.files?.image) {
        const img = req.files.image
        if (img instanceof Array) throw 'why'
        if (img.name.endsWith("ignoreMimeToWebp")) img.mimetype = "image/webp"
        if (!(img.mimetype.startsWith("image/"))) throw "Must be an image >:{"
        if (((img.size > usr.maxMb * 1000000) && !usr.admin) || img.size > 1000000 * 15) throw 'Too Big!'

        const format = img.mimetype.split('/').pop() ?? 'webp'
        if (format != 'gif' && !(img.mimetype as string).endsWith("/webp")) img.data = await sharp(img.data, {animated: false}, ).webp().toBuffer()
        const id = idMaker('img');
        const submittion = new SubmittionModel({
            id: id,        
            author: usr.id,
            content: img.data,
            gif: format == 'gif',
            timestamp: Date.now()
        })
        await submittion.save()
        usr.submitted.push(id)
        await UserModel.findOneAndUpdate({id: usr.id}, { submitted: usr.submitted })
        submittionCache[id] = submittion.doc
        userCache[usr.id] = usr
        res.send({
            id,
            link: `https://${req.hostname}/i/${id}`,
            raw: `https://${req.hostname}/rawi/${id}.${format == 'gif' ? "gif" : "webp"}`
        })
        io.to(usr.id).emit('mePost', {
            id,
            format: format == "gif" ? 'gif' : 'webp'
        })
    } else {
        throw "No Image"
    }
})

app.get('/i/:id', async (req:Request<{id:string}>, res) => {res.send(getImg(req.params.id))})
app.post('/i/:id', async (req:Request<{id:string}>, res) => {res.send(getImg(req.params.id))})

function getImg(id:string):string {
    const idInfo = getIdInfo(id)
    const curCache = submittionCache[idInfo.id]
    if (!curCache) throw "No Image (Render)"
    if (!id.endsWith('.webp') && !id.endsWith('.gif')) {
        if (curCache.gif) id += '.gif'
        else id += '.webp'
    }
    return `<!DOCTYPE html>
<html lang="en">
<head>
<title> Sick ass epic image server </title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:title" content="Shady's image server" />
<meta property="og:image" content="/rawi/${id}" />
<meta property="og:url" content="/i/${id}" />
<meta property="og:description" content="Forcefully shoved onto this by ${userCache[curCache.author].username} on ${new Date(curCache.timestamp).toUTCString()}" />
<meta property="twitter:title" content="Shady's image server" />
<meta property="twitter:image" content="/rawi/${id}" />
<meta name="theme-color" content="#5655b0">
<meta name="twitter:card" content="summary_large_image">
<style>
:root {
    --ico: rgb(225, 222, 222);
    background-color: #202124 !important;
}
*, :after, :before {
    box-sizing: border-box;
    margin: 0 !important;
}
.sc {
    display: flex;
    width: 100%;
    height: 100vh;
    padding-right: 1rem;
    padding-left: 1rem;
}
</style></head>
<body><div class="sc"><img style="object-fit: contain; height: 100%; margin: 0 auto !important; display: block;" src="/rawi/${id}" /></div></body>`}

app.get('/u/:id', async (req:Request<{id:string}>, res:Response<Omit<user, "password">>) => {
    if (!Object.keys(userCache).includes(req.params.id)) throw 'no user'
    const { admin, id, maxMb, submitted, username } = userCache[req.params.id]
    res.send({ id, username, maxMb, submitted, admin })
})

app.get('/u/', async (req, res) => {
    const items:Omit<user, "password">[] = Object.keys(userCache).map((val) => {
        const { username, submitted, maxMb, id, admin } = userCache[val]
        return { 
            username,
            admin,
            id,
            maxMb,
            submitted
        }
    })
    res.send({
        users: items
    })
})


// 

app.post('/u/:name', async (req:Request<{name:string}, Omit<user, "password">, {apass: string, auser:string, password: string, max:number, admin:boolean}>, res) => {
    const id = idMaker('user')
    const adm = authorize(req.body.auser, req.body.apass)
    if (!Object.keys(admin).includes(adm.id)) {
        res.sendStatus(401)
        return
    }
    const usernames:string[] = Object.keys(userCache).map((val) => userCache[val].username)

    if (usernames.includes(req.params.name)) throw "usernameAlreadyExists"

    const pass = await hash(req.body.password, await genSalt(10));

    const usr:user = {
        id,
        maxMb: req.body.max,
        password: pass,
        submitted: [],
        username: req.params.name,
        admin: req.body.admin
    }

    const { maxMb, username } = await (new UserModel(usr)).save()
    
    res.send({
        id,
        maxMb,
        submitted: [],
        username,
        admin: req.body.admin
    })
})
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err:unknown, _req:Request, res:Response, _next:NextFunction) => {res.send({err: err});console.error(err)})
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use(async (err:unknown, _req:Request, res:Response, _next:NextFunction) => {res.send({err: err});console.error(err)})


const s = app.listen(PORT, () => {console.log(`App is listening on port ${PORT}.`)})
const io = new Server<Record<string, never>, {mePost: (p: {format:string, id:string}) => void}, {bad: 'code'}>(s, {
    cors: {
        origin: '*'
    }
})

io.use((socket, next) => {
    try {
        authorize(socket.handshake.auth.id ?? '', socket.handshake.auth.password ?? '')
    } catch (err) {
        next(new Error(err as string))
    }
    next()
})

io.on('connection', (socket) => {
    const usr = authorize(socket.handshake.auth.id, socket.handshake.auth.password)
    socket.join(usr.id)
})