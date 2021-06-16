import express, { Application, NextFunction, Request, Response } from "express";
import fileUpload from "express-fileupload";
import cors from "cors";
import morgan from 'morgan'
import { resolve } from "path";
import { randomBytes } from "crypto"
import sharp from "sharp"
import { AuthorMapSH, authorModel, userModel, UserSH } from "./models/user";
import flash from "connect-flash"
import { compare, genSalt, hash } from "bcrypt";
import mongoose from "mongoose"

const app:Application = express()

app.use(fileUpload({
    createParentPath: true
}));

const uploadDir = resolve('./uploads/') + '/'

app.use(cors({origin: '*', }));
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(morgan('dev'));
app.use(flash())

let cache:{[key: string]: AuthorMapSH} = {}
let acache:{[key:string]: UserSH} = {}
let admin:UserSH;

let idCache: {
    user: string[],
    items: string[]
} = {
    user: [],
    items: []
}

let first = true

app.set('view engine', 'ejs')

const conf:{
    mongodb: {
        username: string,
        password: string,
        ip: string,
        db: string,
        port: string
    }
} = require(resolve('./config.json')) //smh

type res<T> = T | {err:string}

const MongoDBendPoint = `mongodb://${conf.mongodb.username}:${conf.mongodb.password}@${conf.mongodb.ip}:${conf.mongodb.port}/${conf.mongodb.db}?readPreference=primary&appname=MyAppNameHere&ssl=false?authSource=${conf.mongodb.db}`

mongoose.connect(MongoDBendPoint, {useNewUrlParser: true, useUnifiedTopology:true, useFindAndModify:false})

const port = process.env.PORT || 3000;

app.use('/rawi', express.static(uploadDir));
app.use('/', async (req, res, next) => {
    if (first) await cacheGen()
    next()
})

app.get('/baselmao.css', (req, res) => {
    res.sendFile(resolve('./index.css'))
})

function idMaker(mode:keyof typeof idCache):string {
    let id = randomBytes(32).toString('hex')
    if (idCache[mode].includes(id)) {id = idMaker(mode)}
    return id
}

async function authorize(username:string, password:string):Promise<UserSH> {
    const usr:UserSH = await userModel.findOne({username:username})
    if (!usr) throw 'No User'
    compare(password, usr.password, (err, success) => {
        if (err) throw err
        if (success) return usr
        else throw 'No User'
    })
    return usr
}

app.post('/upload', async (req, res) => {
    try {
        let usr:UserSH;
        try {
            if (req.body.username && req.body.password)
                usr = await authorize(req.body.username, req.body.password)
            else throw "nono"
        } catch (err) {
            res.sendStatus(401)
            return
        }

        if (req.files?.image) {
            let img = req.files.image
            if (img instanceof Array) {
                throw 'why?'
            }
            if (!(img.mimetype.startsWith("image/"))) throw "Must be an image >:{"
            if (img.size > usr.maxMb * 1000000) throw 'Too Big!'

            const format = img.mimetype.split('/').pop()
            if (format != 'gif') img.data = await sharp(img.data, {animated: false}, ).webp().toBuffer()

            const id = idMaker('items');
            img.mv(uploadDir + id + (format == 'gif' ? '.gif' : '.webp'))
            const _info2:AuthorMapSH = {
                author: usr.id,
                id: id,
                timestamp: Date.now(),
                gif: format == 'gif'
            }
            const info2 = new authorModel(_info2)
            await info2.save()
            usr.submitted.push(id)
            await userModel.findOneAndUpdate({id: usr.id}, usr)
            cache[id] = _info2
            acache[usr.id] = usr

            res.redirect('/i/' + id + (format == 'gif' ? '.gif' : '.webp'))
        } else {
            throw "No Image"
        }
    } catch (err) {
        res.send({err: err.toString()})
        console.error(err)
    }
})



async function cacheGen() {
    let id1 = []
    let id2 = [];
    (await authorModel.find({}).exec()).forEach((val:AuthorMapSH) => {
        cache[val.id] = val
        id1.push(val.id)
    });
    (await userModel.find({}).exec()).forEach((val:UserSH) => {
        acache[val.id] = val
        id2.push(val.id)
        if (val.username == 'shady') admin = val
    });

    idCache = {
        items: id1,
        user: id2
    }

    first = false
}

function getImg(req:Request, res:Response) {
    let tester1 = req.params.id.split('.').pop()

    if (tester1 == 'gif' || tester1 == 'webp') req.params.id = req.params.id.substr(0, req.params.id.length - tester1.length - 1)

    const curCache = cache[req.params.id]
    if (!curCache) throw "No Image (Render)"
    if (!req.params.id.endsWith('.webp') && !req.params.id.endsWith('.gif')) {
        if (curCache.gif) req.params.id += '.gif'
        else req.params.id += '.webp'
    }
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <title> Sick ass epic image server </title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta property="og:title" content="Shady's image server" />
    <meta property="og:image" content="/rawi/${req.params.id}" />
    <meta property="og:url" content="/i/${req.params.id}" />
    <meta property="og:description" content="Forcefully shoved onto this by ${acache[curCache.author].username} on ${new Date(curCache.timestamp).toUTCString()}" UTC />
    <meta property="twitter:title" content="Shady's image server" />
    <meta property="twitter:image" content="/rawi/${req.params.id}" />

    <meta name="theme-color" content="#5655b0">
    <meta name="twitter:card" content="summary_large_image">

    <link rel="stylesheet" href="/baselmao.css" crossorigin="anonymous">

    <style>
    *, :after, :before {
        box-sizing: border-box;
        margin: 0 !important;
    }
    </style>
</head>
<body>
    <div class="scontainer">
        <img style="object-fit: contain; height: 100%; margin: 0 auto !important; display: block;" src="/rawi/${req.params.id}" />
    </div>
</body>`
}

app.get('/i/:id', async (req, res) => {try{
    res.send(getImg(req, res))
} catch (err) {
    res.send({err: err.toString()})
    console.error(err)
}})
app.post('/i/:id', async (req, res) => {try{
    res.send(getImg(req, res))
} catch (err) {
    res.send({err: err.toString()})
    console.error(err)
}})

app.get('/u/:id', async (req:Request<{id:string}>, res:Response<res<Omit<UserSH, "password">>>) => {try{
    let user:UserSH = acache[req.params.id]
    if (!user) throw 'no user'

    res.send({
        id: user.id,
        username: user.username,
        maxMb: user.maxMb,
        submitted: user.submitted
    })
} catch (err) {
    res.send({err: err.toString()})
    console.error(err)
}})

app.get('/u/', async (req, res) => {
    let items:Omit<UserSH, "password">[] = Object.keys(acache).map((val) => {
        let vall = acache[val]
        return {
            id: vall.id,
            maxMb: vall.maxMb,
            submitted: vall.submitted,
            username: vall.username
        }
    })
    res.send({
        users: items
    })
})

app.post('/u/:name', async (req:Request<{name:string}, res<Omit<UserSH, "password">>, {apass: string, auser:string, password: string, max:number}>, res) => {try{
    let id: string;
    const adm = await authorize(req.body.auser, req.body.apass)
    if (adm.username != admin.username && adm.password != admin.password) {
        res.sendStatus(401)
        return
    }
    const userss = Object.keys(acache).map((val) => {
        return acache[val].username
    })
    if (userss.includes(req.params.name)) {
        res.send({
            err: "Username already exists!"
        })
        return
    }
    const salt = await genSalt(10)
    const pass = await hash(req.body.password, salt);

    let usr:UserSH = {
        id: idMaker('user'),
        maxMb: req.body.max,
        password: pass,
        submitted: [],
        username: req.params.name
    }

    const _usr = new userModel(usr)
    await _usr.save()
    acache[usr.id] = usr
    res.send({
        id: id,
        maxMb: req.body.max,
        submitted: [],
        username: req.params.name
    })
} catch(err) {
    res.send({err: err.toString()})
    console.error(err)
}})

app.use((err:any, _req:Request, res:Response, _next:NextFunction) => {
    res.send({err: err.toString()})
    console.error(err)
})


app.listen(port, () =>
    console.log(`App is listening on port ${port}.`)
);