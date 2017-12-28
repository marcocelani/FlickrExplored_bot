import * as telebot from 'telebot';
import * as rp from 'request-promise';
import * as async from 'async';
import * as htmlparser from 'htmlparser2';
import * as moment from 'moment';
import * as mongoose from 'mongoose';
import { Config } from './Config';
import { FlickrConfig } from './flickrconfig';
import { IImgsCore, IImg } from './iimgscore'
import { ICBChoice } from './models/icbchoice'
import { IUserModel, UserModel, IUserSetup } from './models/userModel';
import { IUserSettings } from './models/userSettings';
import { Model } from 'mongoose';
import { Message } from './models/message';
import { ITask } from './models/itask';
import { IFlickrPhotoInfo } from './models/iflickrphotoinfo';
import { IFlickrPhotoUrl } from './models/iflickrphotourl';
import { UriOptions, CoreOptions } from 'request';
import { Moment } from 'moment';
import { IStats } from './models/istats';

class FlickrExpored {
    private bot: telebot;
    private userModel: Model<IUserModel>;
    /** Core Data Structure [for imgs]**/
    private imgsObj: IImgsCore;
    /*************************/
    /* Users settings DS     */
    /*************************/
    private usersSettings: IUserSettings = {};
    /*************************/
    /* Users that are waiting for photo.
    /*************************/
    private waitingRoom: Array<Message> = [];
    private CB_CHOICE: Array<ICBChoice> = [
        { type: 'sameHour', text: 'Every Day [same hour]' },
        { type: 'randomHour', text: 'Every Day [random hour]' },
        { type: 'deleteSetup', text: 'Remove setting.' }
    ];
    /**************************/
    constructor() {
        this.logInfo(`Starting ${Config.APP_NAME}[PID:${process.pid}]`);
        process.on('SIGINT', () => {
            if (Config.USEMONGO) {
                this.closeMongoConnection();
            }
        });
        process.on('SIGTERM', () => {
            if (Config.USEMONGO) {
                this.closeMongoConnection();
            }
        });
        if (Config.USEMONGO) {
            (<any>mongoose).Promise = global.Promise;
            mongoose.connect(Config.MONGO_URI, { useMongoClient: true });
            mongoose.connection.on('connected', () => {
                this.logInfo(`Mongoose connection open on:${Config.MONGO_URI}`);
            });
            mongoose.connection.on('error', (err) => {
                this.logErr(err);
            });
            mongoose.connection.on('disconnected', () => {
                this.logInfo('Mongoose disconnected.');
            });
        }
        this.imgsObj = {
            lastUpdate: moment(),
            scrapeInProgress: false,
            imgs: []
        };
        this.bot = new telebot(Config.TELEBOT_OPT);
        this.userModel = new UserModel().user;
    }

    private closeMongoConnection() {
        const self: FlickrExpored = this;
        mongoose.connection.close(() => {
            self.logInfo('Mongoose default connection disconnected through app termination.');
            process.exit(0);
        });
    }

    private getUserName(msg: Message): string {
        if (!msg && !msg.from)
            return '(not found)';
        return (msg.from.username) ? `@${msg.from.username}` : `@id:${msg.from.id}`;
    }

    private welcomeText(msg) {
        return `Welcome ${this.getUserName(msg)}!
With @FlickrExplored_bot you can:
1- show random Flickr's Explore images;
2- schedule the bot for getting photo every day automatically;
3- search photos with inline query;
4- send your location and get top five photos near you.`
    }

    private getRateMarkUp(): any {
        return this.bot.inlineKeyboard(
            [
                [
                    this.bot.inlineButton('Do you like this bot?', { url: Config.RATE_URL })
                ]
            ]
        );
    }

    private insertNewDoc(msg: Message): Promise<void> {
        return new Promise<void>(
            (resolve, reject) => {
                const user = new this.userModel();
                user.first_name = msg.from.first_name;
                user.is_bot = msg.from.is_bot;
                user.user_id = msg.from.id;
                if (msg.from.last_name)
                    user.last_name = msg.from.last_name;
                if (msg.from.language_code)
                    user.language_code = msg.from.language_code;
                user.count = 0;
                user.is_stopped = false;
                user.userSetup = null;
                user.save((err, res, affected) => {
                    if (err) {
                        this.logErr(err);
                        reject();
                        return;
                    }
                    this.logInfo(`user[${this.getUserName(msg)}] saved.`);
                    resolve();
                });
            }
        );
    }

    private setDBUser(msg: Message): Promise<void> {
        return new Promise<void>(
            async (resolve) => {
                if (!Config.USEMONGO) {
                    resolve();
                    return;
                }
                try {
                    const user = await this.userModel.findOne()
                        .where({ user_id: msg.from.id })
                        .exec();
                    const self: FlickrExpored = this;
                    if (!user)
                        try {
                            await this.insertNewDoc(msg);
                        }
                        catch (err) {
                            throw err;
                        }
                    else
                        try {
                            await this.userModel.update(
                                { user_id: msg.from.id },
                                { is_stopped: false },
                                (err, raw) => {
                                    if (err) {
                                        self.logErr(err);
                                        return;
                                    }
                                }
                            );
                        } catch (err) {
                            throw err;
                        }

                }
                catch (err) {
                    this.logErr(err);
                } finally {
                    resolve();
                }
            }
        );
    }

    private getWelcome(msg: Message): void {
        const self: FlickrExpored = this;
        this.setDBUser(msg)
            .then(() => {
                self.getPhotoV2(msg, false, true)
                    .then(() => {
                        self.sendMessage(msg, `${this.welcomeText(msg)}${this.usage()}`, { replyMarkup: this.getRateMarkUp() });
                    }).catch(err => {
                        self.logErr(err);
                    });
            });
    }

    /* get randomic number between 0 and max. */
    private getRandomic(upperBound: number): number {
        if (upperBound && typeof (upperBound) !== 'number')
            return 0;
        const min = 0; //choose your lowerBound if you want.
        const max = Math.floor(upperBound);
        if (min > max)
            return Math.floor(Math.random() * (min - max)) + max;
        else
            return Math.floor(Math.random() * (max - min)) + min;
    }

    private getPhotoV2(msg: Message,
        fromSetting?: boolean,
        isNewUser?: boolean): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            if (this.imgsObj.scrapeInProgress) {
                //Go to waiting room.
                this.waitingRoom.push(msg);
                this.logInfo(`user ${msg.from.id} into waiting room.`);
                this.sendMessage(msg, `A scrape job is in progress. When job is done you will receive the photo. Sorry for the inconvenient.`);
                resolve();
                return;
            }
            if (this.imgsObj.imgs.length == 0) {
                this.logErr(`imgs is empty`);
                this.sendMessage(msg, `Images not available at moment. Please try later.`);
                resolve();
                return;
            }

            let imgsIds: IImg;
            let img_id: string;
            if (this.imgsObj.imgs.length > 0) {
                imgsIds = this.imgsObj.imgs[this.getRandomic(this.imgsObj.imgs.length - 1)];
                if (imgsIds.imgsArr.length > 0) {
                    img_id = imgsIds.imgsArr[this.getRandomic(imgsIds.imgsArr.length - 1)];
                }
                else {
                    this.logErr(`imgsIds is empty.`);
                    this.replyError(msg);
                    reject(new Error(`imgsIds is empty.`));
                    return;
                }
            }
            else {
                this.logErr(`imgs is empty.`);
                this.replyError(msg);
                reject(new Error(`imgs is`));
                return;
            }

            try {
                const photo_url: IFlickrPhotoInfo = await this.getPhotoUrlFromId(img_id);
                if (photo_url.stat === 'fail') {
                    this.replyError(msg);
                    this.logErr(photo_url.message);
                    reject();
                    return;
                }

                if (Config.USEMONGO) {
                    const self: FlickrExpored = this;
                    this.userModel.update(
                        { user_id: msg.from.id },
                        {
                            $inc: { 'count': 1 },
                            $set: { is_stopped: false }
                        },
                        (err, raw) => {
                            if (err) {
                                self.logErr(err);
                                return;
                            }
                            this.logInfo(`User ${this.getUserName(msg)}: count field updated`);
                        });
                }

                this.sendMessage(msg, photo_url.url);
                if (fromSetting)
                    this.sendMessage(msg, `Done. Next photo on ${moment(this.usersSettings[msg.from.id].userSetup.nextPhotoTime).format('DD/MM/YYYY HH:mm')} UTC.`);
            }
            catch (err) {
                this.logErr(err);
            }
            finally {
                resolve();
            }
        });
    }

    private getMsgError(response: any): string {
        if (response) {
            return `Something goes wrong. Flickr response:${response.message}, code:${response.code}`;
        }
        return '';
    }

    private getPhotoUrlFromId(img_id: string): Promise<IFlickrPhotoInfo> {
        return new Promise<IFlickrPhotoInfo>(
            (resolve, reject) => {
                const rpOpt: UriOptions & CoreOptions = {
                    uri: FlickrConfig.ENDPOINT,
                    qs: {
                        method: FlickrConfig.METHODS[2],
                        api_key: FlickrConfig.API_KEY,
                        photo_id: img_id,
                        format: FlickrConfig.FORMAT,
                        nojsoncallback: FlickrConfig.NOJSONCB
                    },
                    json: true
                };

                rp(rpOpt)
                    .then(response => {
                        if (response.stat === 'fail') {
                            resolve({ stat: 'fail', message: this.getMsgError(response) });
                        } else {
                            if (response.photo
                                && response.photo.urls
                                && response.photo.urls.url
                                && response.photo.urls.url[0]
                                && response.photo.urls.url[0]._content) {
                                resolve({
                                    stat: 'ok',
                                    url: response.photo.urls.url[0]._content,
                                    url_physic_z: this.getPhysicUrl(
                                        response.photo.farm,
                                        response.photo.server,
                                        response.photo.id,
                                        response.photo.secret,
                                        'z'
                                    ),
                                    title: (response.photo.title
                                        && response.photo.title._content)
                                        ? response.photo.title._content
                                        : ''
                                });
                            } else {
                                resolve({ stat: 'fail', message: 'wrong response.' });
                            }
                        }
                    }).catch(err => {
                        this.logErr(err.message);
                        reject(err);
                    });
            }
        );
    }

    private getPhysicUrl(
        farm_id: string,
        server_id: string,
        id: string,
        secret: string,
        size: string): string {
        if (!size)
            return `https://farm${farm_id}.staticflickr.com/${server_id}/${id}_${secret}.jpg`;
        else
            return `https://farm${farm_id}.staticflickr.com/${server_id}/${id}_${secret}_${size}.jpg`;
    }

    private replyError(msg: Message) {
        return this.sendMessage(msg, `Something goes wrong.`);
    }

    private isFromGroup(msg: Message): boolean {
        if (msg
            && msg.chat
            && msg.chat.type
            && (msg.chat.type === 'group'
                || msg.chat.type === 'supergroup'
                || msg.chat.type === 'channel')
        ) return true;
        return false;
    }

    private logInfo(mex: string): void {
        this.log('INFO', mex);
    }

    private logErr(mex: string | Error) {
        this.log('ERR', mex);
    };

    private log(type: string, mex: string | Error) {
        if (!type)
            type = 'INFO';
        if (mex instanceof Error)
            console.error(`[${type}][${moment().format('DD/MM/YYYY HH:mm:ss')}] ${mex.message}`);
        else
            (type === 'ERR')
                ? console.error(`[${type}][${moment().format('DD/MM/YYYY HH:mm:ss')}] ${mex}`)
                : console.log(`[${type}][${moment().format('DD/MM/YYYY HH:mm:ss')}] ${mex}`);
    }

    private resetTime(msg: Message): void {
        if (this.usersSettings[msg.from.id]
            && this.usersSettings[msg.from.id].scheduledTimer) {
            clearTimeout(this.usersSettings[msg.from.id].scheduledTimer);
        }
    }

    private removeUserDBSetting(msg: Message): void {
        if (!Config.USEMONGO)
            return;
        const self: FlickrExpored = this;
        this.userModel.findOneAndUpdate(
            { user_id: msg.from.id },
            { $set: { userSetup: null } },
            (err, doc, res) => {
                if (err) {
                    self.logErr(err);
                    return;
                }
            }
        )
    }

    private resetSetting(msg: Message, msgSend: boolean): void {
        this.resetTime(msg);
        this.removeUserDBSetting(msg);
        this.usersSettings[msg.from.id] = null;
        if (msgSend)
            this.sendMessage(msg, `Setting removed.`);
    }

    private manageSendError(err: any, msg: Message) {
        if (err && err.error_code && err.error_code == 403) {
            this.logInfo(`${this.getUserName(msg)} has stopped and blocked the bot.`);
            if (Config.USEMONGO) {
                const self: FlickrExpored = this;
                this.userModel.findOneAndUpdate(
                    { user_id: msg.from.id },
                    { is_stopped: true },
                    (err, doc, res) => {
                        if (err) {
                            self.logErr(err);
                            return;
                        }
                    }
                );
            }
            this.resetSetting(msg, false);
        } else {
            console.log('Error in sendMessage:', err);
        }
    }

    private sendMessage(msg: Message, text: string, obj?: any): void {
        let id = -1;
        if (!msg && !msg.chat && !msg.chat.type)
            return;
        if (this.isFromGroup(msg)) {
            id = msg.chat.id;
        }
        else {
            id = msg.from.id;
        }

        if (obj)
            this.bot.sendMessage(id, text, obj)
                .catch(err => { this.manageSendError(err, msg); });
        else
            this.bot.sendMessage(id, text)
                .catch(err => { this.manageSendError(err, msg); });
    }

    private usage(): string {
        return `Type /photo for pick a photo.
Type /setup for setting some options.
Type /help for showing help.
Type /about for showing info.
Type /stop for stopping.
Search photos with inline query.
Send your location and get top five photos near you. `;
    }

    private getStats(msg: Message): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const stats: IStats = {
                allUsers: 0,
                activeUsers: 0,
                botUsers: 0,
                totalImagesRequested: 0,
                lastUpdate: this.imgsObj.lastUpdate,
                imgsLength: this.imgsObj.imgs.length,
                scrapeInProgress: this.imgsObj.scrapeInProgress
            };
            if (!Config.USEMONGO) {
                this.logInfo(`Cannot quering mongo due app configuration.`);
                resolve(JSON.stringify(stats, null, 4));
                return;
            }
            this.userModel.find((err, res) => {
                if (err) {
                    this.logErr(err);
                    reject(err);
                    return;
                }
                async.forEachSeries<IUserModel, Error>(res,
                    (item, cb) => {
                        stats.allUsers++;
                        if (item.is_bot)
                            stats.botUsers++;
                        if (item.is_stopped === false)
                            stats.activeUsers++;
                        stats.totalImagesRequested += item.count;
                        cb(null);
                    },
                    err => {
                        resolve(JSON.stringify(stats, null, 4));
                    });
            });
        });
    }

    private about(msg: Message): void {
        let replyMarkup = this.bot.inlineKeyboard(
            [
                [
                    this.bot.inlineButton(`GitHub repository`, { url: 'https://github.com/marcocelani/FlickrExplored_bot' })
                ],
                [
                    this.bot.inlineButton(`Do you like this bot? Please rate.`, { url: Config.RATE_URL })
                ]
            ]
        );
        return this.sendMessage(msg, `${Config.APP_NAME} made by @${Config.TELEGRAM_USERNAME}.`, { replyMarkup: replyMarkup });
    }

    private getStop(msg: Message): void {
        if (this.isFromGroup(msg)) {
            this.sendMessage(msg, 'Stops command not allowed to group.');
            return;
        }
        if (Config.USEMONGO) {
            const self: FlickrExpored = this;
            this.userModel.update(
                { user_id: msg.from.id },
                { is_stopped: true },
                (err, raw) => {
                    if (err) {
                        self.logErr(err);
                        return;
                    }
                    self.logInfo(`is_stopped flag set to false for ${this.getUserName(msg)}`);
                });
        }
        this.resetTime(msg);
        this.userModel[msg.from.id] = null;
        this.sendMessage(msg, `Bye, bye ${this.getUserName(msg)}`);
    }

    private setupText(): string {
        return `You can setup this bot for getting photo automatically.  
You don't have any setting yet. Please make a choice.`
    }

    private getNoDataInlineKeyBoard(): any {
        return this.bot.inlineKeyboard(
            [
                [
                    this.bot.inlineButton(this.CB_CHOICE[0].text, { callback: this.CB_CHOICE[0].type }),
                ],
                [
                    this.bot.inlineButton(this.CB_CHOICE[1].text, { callback: this.CB_CHOICE[1].type })
                ],
                /* TODO */
                /*[
                    bot.inlineButton('Every Day [custom hour]', {callback: 'TODO'})
                ]*/
            ]
        );
    }

    private getSameHourInlineKeyBoard(): any {
        return this.bot.inlineKeyboard(
            [
                [
                    this.bot.inlineButton(this.CB_CHOICE[1].text, { callback: this.CB_CHOICE[1].type })
                ],
                [
                    this.bot.inlineButton(this.CB_CHOICE[2].text, { callback: this.CB_CHOICE[2].type })
                ]
            ]
        );
    }

    private getRandomHourInlineKeyBoard(): any {
        return this.bot.inlineKeyboard(
            [
                [
                    this.bot.inlineButton(this.CB_CHOICE[0].text, { callback: this.CB_CHOICE[0].type })
                ],
                [
                    this.bot.inlineButton(this.CB_CHOICE[2].text, { callback: this.CB_CHOICE[2].type })
                ]
            ]
        );
    }

    private setupSameHourText(msg: Message): string {
        return this.setupRandomHourText(msg);
    }

    private setupRandomHourText(msg: Message): string {
        return `Next photo on:${moment(this.usersSettings[msg.from.id].userSetup.nextPhotoTime).format('DD/MM/YYYY HH:mm')}`;
    }

    private setup(msg: Message): void {
        if (msg.chat.type === 'group'
            || msg.chat.type === 'supergroup'
            || msg.chat.type === 'channel') {
            this.sendMessage(msg, `Setup command not allowed in groups.`); /* TODO? I don't know. */
            return;
        }
        if (Config.USEMONGO) {
            const self: FlickrExpored = this;
            this.userModel.findOne({ user_id: msg.from.id },
                (err, res) => {
                    if (err) {
                        self.logErr(err);
                        return;
                    }
                    if (!res) {
                        self.getWelcome(msg);
                        return;
                    }
                }
            );
        }
        if (!this.usersSettings[msg.from.id]
            || !this.usersSettings[msg.from.id].userSetup) {
            const replyMarkup = this.getNoDataInlineKeyBoard();
            this.sendMessage(msg, this.setupText(), { replyMarkup: replyMarkup });
        }
        else if (this.usersSettings[msg.from.id].userSetup.type === this.CB_CHOICE[0].type) { /* same hour */
            const replyMarkup = this.getSameHourInlineKeyBoard();
            this.sendMessage(msg, this.setupSameHourText(msg), { replyMarkup: replyMarkup });
        }
        else if (this.usersSettings[msg.from.id].userSetup.type === this.CB_CHOICE[1].type) { /* random hour */
            let replyMarkup = this.getRandomHourInlineKeyBoard();
            this.sendMessage(msg, this.setupRandomHourText(msg), { replyMarkup: replyMarkup });
        }
    }

    private flickrSearch(msg: Message): void {
        if (!msg)
            return;

        let query = '';
        if (msg.query)
            query = msg.query.trim();

        const answers: telebot.AnswerList = this.bot.answerList(msg.id, { cacheTime: 60 });

        if (query === ''
            && this.imgsObj.imgs.length > 0) {
            const idArr = this.imgsObj.imgs[this.getRandomic(this.imgsObj.imgs.length - 1)].imgsArr;
            const self: FlickrExpored = this;
            async.each(idArr,
                (id, cb) => {
                    self.getPhotoUrlFromId(id)
                        .then(result => {
                            if (result.stat === 'fail') {
                                self.logErr(`error in flickrSearch[async.each]:${result.message}`);
                                cb(null);
                                return;
                            }
                            answers.addPhoto({
                                id: id,
                                title: result.title,
                                photo_url: result.url_physic_z,
                                thumb_url: result.url_physic_z,
                                input_message_content: { message_text: result.url }
                            });
                            cb(null);
                        });
                },
                (err) => {
                    if (err) {
                        //self.log('ERR', err);
                        return;
                    }
                    this.bot.answerQuery(answers);
                }
            );

            return;
        }

        this.searchPhoto(msg, this.prepareRPSearchObj(query), answers);
    }

    private prepareRPSearchObj(query?: string): UriOptions & CoreOptions {
        const INDEX: number = 3; //photo.search
        return {
            uri: FlickrConfig.ENDPOINT,
            qs: {
                method: FlickrConfig.METHODS[INDEX],
                api_key: FlickrConfig.API_KEY,
                text: (query) ? query : '',
                sort: FlickrConfig.SORT[INDEX],
                parse_tag: FlickrConfig.PARSE_TAG[INDEX],
                content_type: FlickrConfig.CONTENT_TYPE[INDEX],
                extras: FlickrConfig.EXTRAS[INDEX],
                per_page: FlickrConfig.PER_PAGE[INDEX],
                page: FlickrConfig.PAGE[INDEX],
                format: FlickrConfig.FORMAT,
                nojsoncallback: FlickrConfig.NOJSONCB,
            },
            json: true
        };
    }

    private searchPhoto(msg: Message,
        rpObj: UriOptions & CoreOptions,
        answers?: telebot.AnswerList) {
        if (!msg && rpObj)
            return;

        rp(rpObj)
            .then(response => {
                if (response.stat === 'fail') {
                    this.logErr(this.getMsgError(response));
                    return;
                }

                let photosArr: Array<any> = response.photos.photo;

                if (!photosArr)
                    return;

                if (photosArr.length == 0) {
                    this.sendMessage(msg, `Sorry, no photos found.`);
                }

                async.each(photosArr,
                    (photo, cb) => {
                        this.getPhotoUrlFromId(photo.id)
                            .then(result => {
                                if (result.stat === 'fail') {
                                    console.log(result);
                                    cb(null);
                                    return;
                                }
                                const url_arr = this.buildUrlArr(photo);
                                if (url_arr.length == 0) {
                                    cb(null);
                                    return;
                                }
                                if (answers) {
                                    answers.addPhoto({
                                        id: photo.id,
                                        title: photo.title,
                                        photo_url: url_arr[0].url,
                                        photo_width: parseInt(url_arr[0].width),
                                        photo_height: parseInt(url_arr[0].height),
                                        thumb_url: url_arr[0].url,
                                        input_message_content: { message_text: result.url }
                                    });
                                } else {
                                    this.sendMessage(msg, result.url);
                                }

                                cb(null);
                            });
                    },
                    (err) => {
                        if (answers) {
                            this.bot.answerQuery(answers);
                        }
                    }
                );
            })
            .catch(err => {
                console.log(`error in searchPhoto:${err.name} -> ${err.statusCode}`)
            });
    }

    private buildUrlArr(photo: any): Array<IFlickrPhotoUrl> {
        const url_arr: Array<IFlickrPhotoUrl> = [];
        if (photo.width_m && photo.height_m)
            url_arr.push({ url: photo.url_m, width: photo.width_m, height: photo.height_m });
        if (photo.width_n && photo.height_n)
            url_arr.push({ url: photo.url_n, width: photo.width_n, height: photo.height_n });
        if (photo.width_z && photo.height_z)
            url_arr.push({ url: photo.url_z, width: photo.width_z, height: photo.height_z });
        if (photo.width_c && photo.height_c)
            url_arr.push({ url: photo.url_c, width: photo.width_c, height: photo.height_c });
        if (photo.width_l && photo.height_l)
            url_arr.push({ url: photo.url_l, width: photo.width_l, height: photo.height_l });
        if (photo.width_o && photo.height_o)
            url_arr.push({ url: photo.url_o, width: photo.width_o, height: photo.height_o });
        return url_arr;
    }

    private isGeoSearch(msg: Message): boolean {
        if (!msg &&
            !msg.location &&
            !msg.location.latitude &&
            !msg.location.longitude)
            return false;
        return true;
    }

    private flickrGeoSearch(msg: Message): void {
        if (!this.isGeoSearch(msg))
            return;

        let rpObj = this.prepareRPSearchObj()
        rpObj.qs.lat = msg.location.latitude;
        rpObj.qs.lon = msg.location.longitude;
        rpObj.qs.per_page = 5;
        this.searchPhoto(msg, rpObj);
    }

    private setBotCommand() {
        this.bot.on('/start', (msg) => { this.getWelcome(msg); });
        this.bot.on('/photo', (msg) => {
            this.getPhotoV2(msg)
                .catch(err => { this.logErr(err); });
        });
        this.bot.on('/help', (msg) => { this.sendMessage(msg, this.usage()); });
        this.bot.on('/about', (msg) => { this.about(msg); });
        this.bot.on('/stats', async (msg) => { this.getStats(msg).then(text => { this.sendMessage(msg, text) }).catch(err => { }); });
        this.bot.on('/stop', (msg) => { this.getStop(msg); });
        this.bot.on('/setup', (msg) => { this.setup(msg); });
        this.bot.on('inlineQuery', (msg) => { this.flickrSearch(msg); });
        this.bot.on('location', (msg) => { this.flickrGeoSearch(msg); });
    }

    private setBotListeners() {
        this.bot.on('callbackQuery', msg => {
            if (msg.data === this.CB_CHOICE[0].type) { /* same hour */
                this.setSameHourSetting(msg);
            } else if (msg.data === this.CB_CHOICE[1].type) { /* random hour */
                this.setRandomHourSetting(msg);
            } else if (msg.data === this.CB_CHOICE[2].type) { /* reset */
                this.resetSetting(msg, true);
            } else {
                this.sendMessage(msg.from.id, `Wrong choice: ${msg.data}`);
            }
        });
    }

    private scrapeEngine(name: string,
        attribs: { [type: string]: string },
        imgsArr: Array<string>): void {
        if (name === 'div'
            && attribs.style) {
            const tokens = attribs.style.split(':');
            for (let i = 0; i < tokens.length; ++i) {
                let token = tokens[i].trim();
                if (token.includes('url')
                    && token.length > 4) {
                    const img_url = token.substring(4, token.length - 1);
                    if (img_url.endsWith('.jpg')
                        || img_url.endsWith('.JPG')) {
                        let img: Array<string> = img_url.split('/');
                        if (img.length == 0) {
                            this.logErr('img has no length.');
                            return;
                        }
                        const _img = img[img.length - 1];
                        const img_id = _img.split('_');
                        if (img_id.length == 0) {
                            this.logErr('img_id has no length.');
                            return;
                        }
                        imgsArr.push(img_id[0]);
                    }
                }
            }
        }
    }

    private scrapeImg() {
        if (this.imgsObj.scrapeInProgress) {
            this.logInfo(`Another scrape is in progress.`);
            return;
        }
        const flickrUrlsArr: Array<string> = [];
        let dayBefore: number = Config.DAY_BEFORE - this.imgsObj.imgs.length;
        if (dayBefore < 0) {
            this.logErr(`dayBefore:${dayBefore}. Negative values found. I'm restoring imgs array.`);
            this.imgsObj.imgs = [];
            dayBefore = Config.DAY_BEFORE;
        }
        if (dayBefore != 0) {
            this.logInfo(`imgs needs update. dayBefore:${dayBefore}`);
            this.imgsObj.scrapeInProgress = true;

            const mDate = moment().subtract(1, 'days');
            let mDateStr = mDate.format('YYYY/MM/DD');

            let rpOptArr: Array<ITask> = [];
            for (let i = 0; i < dayBefore; ++i) {
                rpOptArr.push({
                    task_id: i,
                    dateStr: mDateStr,
                    rpOpt: { uri: FlickrConfig.FLICKR_EXPLORE_URL + mDateStr }
                });
                mDateStr = mDate.subtract(1, 'days').format('YYYY/MM/DD');
            }

            this.logInfo('starting parallel tasks...');
            async.eachLimit(rpOptArr, 2,
                (rpOptItem, cb) => {
                    if (!rpOptItem.rpOpt) {
                        cb(new Error(`Wrong rpOpt.`));
                        return;
                    }

                    this.logInfo(`task ${rpOptItem.task_id} started.`)
                    let imgsArr: Array<string> = [];
                    const self: FlickrExpored = this;
                    let parser = new htmlparser.Parser(
                        {
                            onopentag: function (name: string, attribs: { [type: string]: string }) {
                                self.scrapeEngine(name, attribs, imgsArr);
                            }
                        });

                    rp(rpOptItem.rpOpt)
                        .then(response => {
                            parser.write(response);
                            parser.end();
                            this.logInfo(`task ${rpOptItem.task_id} ended.`);
                            this.imgsObj.imgs.push({ date: rpOptItem.dateStr, imgsArr: imgsArr });
                            cb(null);
                        })
                        .catch(err => {
                            this.logErr(`Error in scrapeImg:${err.name} -> ${err.statusCode}`);
                            cb(null);
                        });
                },
                (err: Error) => {
                    if (err) {
                        this.logErr(`Something goes wrong:${err.message}.`);
                    }
                    this.imgsObj.lastUpdate = moment();
                    this.imgsObj.scrapeInProgress = false;
                    this.logInfo('Tasks completed.');

                    let count = 0;
                    let item = this.waitingRoom.pop();

                    if (item)
                        this.logInfo('Empty the waiting room.');

                    const self: FlickrExpored = this;

                    function empty_waiting_room() {
                        while (item && count < 10) {
                            ++count;
                            self.getPhotoV2(item).catch();
                            item = self.waitingRoom.pop();
                        }

                        if (item) {
                            count = 0;
                            process.nextTick(empty_waiting_room);
                        } else {
                            self.logInfo('Waiting room is empty.');
                        }
                    }

                    empty_waiting_room();
                }
            );
        }
    }

    private getUserObj(type: string): IUserSetup {
        return <IUserSetup>{
            type: type,
            nextPhotoTime: new Date()
        }
    }

    private getTotMillis(userObj: IUserSetup): number {
        let totMillis = moment(userObj.nextPhotoTime).valueOf() - moment().valueOf();
        if (totMillis < 0 || isNaN(totMillis) || !isFinite(totMillis))
            totMillis = 60 * 1000 * 24;
        return totMillis;
    }

    private getRandomicTimeHour(date: Moment): Date {
        if (!date)
            return moment().add(1, 'day').hours(0).add(this.getRandomic(24) + 1, 'hours').toDate();
        return date.add(1, 'day').hours(0).add(this.getRandomic(24) + 1, 'hours').toDate();
    }

    private getSameTimeHour(date: Moment): Date {
        if (!date)
            return moment().add(2, 'minutes').toDate();
        return date.add(1, 'day').toDate();
    }

    private updateUserDBSetting(msg: Message, userObj: IUserSetup): void {
        if (!Config.USEMONGO)
            return;
        this.userModel.findOneAndUpdate(
            { user_id: msg.from.id },
            {
                $set: {
                    userSetup: (userObj) ? { nextPhotoTime: userObj.nextPhotoTime, type: userObj.type } : null,
                    is_stopped: false
                }
            },
            (err, doc, res) => {
                if (err) {
                    this.logErr(err);
                    return;
                }
            }
        );
    }

    private settingInterval(msg: Message, totMillis: number, type: string): NodeJS.Timer {
        if (!type)
            type = this.CB_CHOICE[1].type;
        const self: FlickrExpored = this;
        return setTimeout(function () {
            self.getPhotoV2(msg)
                .catch(err => { self.logErr(err); });
            if (self.usersSettings[msg.from.id]) {
                if (type === self.CB_CHOICE[1].type)
                    self.setRandomHourSetting(msg, true);
                else
                    self.setSameHourSetting(msg, true);
            }
        }, totMillis, msg);
    }

    private setUser(msg: Message): IUserModel {
        const user = <IUserModel>{
            user_id: msg.from.id,
            is_bot: msg.from.is_bot,
            first_name: msg.from.first_name,
            count: 0,
            userSetup: null
        }
        if (msg.from.last_name)
            user.last_name = msg.from.last_name;
        if (msg.from.language_code)
            user.language_code = msg.from.language_code;
        return user;
    }

    private setHourSetting(msg: Message, type: string, hideMessage?: boolean, restoring?: boolean, noDBUpdate?: boolean) {
        this.resetTime(msg);

        if (!type)
            type = this.CB_CHOICE[0].type;

        let userObj = this.getUserObj(type);

        const userDate = moment(msg.message.date).toDate();
        if (!restoring)
            userObj.nextPhotoTime = (type === this.CB_CHOICE[1].type)
                ? this.getRandomicTimeHour(moment())
                : this.getSameTimeHour(moment());
        else {
            userObj.nextPhotoTime = moment(userDate).toDate();
        }

        const totMillis = this.getTotMillis(userObj);

        if (!noDBUpdate)
            this.updateUserDBSetting(msg, userObj);

        if (!this.usersSettings[msg.from.id]) {
            this.usersSettings[msg.from.id] = this.setUser(msg);
        }
        this.usersSettings[msg.from.id].userSetup = userObj;
        this.usersSettings[msg.from.id].scheduledTimer = this.settingInterval(msg, totMillis, type);

        if (!hideMessage
            && !restoring
            && !noDBUpdate) {

            this.getPhotoV2(msg, true)
                .catch(err => { this.logErr(err); });
        }

        if (hideMessage && restoring)
            this.logInfo(`user ${msg.from.id} restored.`);
    }

    private setRandomHourSetting(msg: Message,
        hideMessage?: boolean, restoring?: boolean, noDBUpdate?: boolean) {
        this.setHourSetting(msg, this.CB_CHOICE[1].type, hideMessage, restoring, noDBUpdate);
    }

    private setSameHourSetting(msg: Message,
        hideMessage?: boolean, restoring?: boolean, noDBUpdate?: boolean) {
        this.setHourSetting(msg, this.CB_CHOICE[0].type, hideMessage, restoring, noDBUpdate);
    }

    private restoreUsersSetting() {
        if (!Config.USEMONGO)
            return;
        this.userModel.find(
            { 'userSetup': { $ne: null } },
            (err: any, result: Array<IUserModel>) => {
                if (err) {
                    this.logErr(err);
                    return;
                }

                /* splitting */
                let sidx = 0;
                let size = 10;
                let i = 0;

                const self: FlickrExpored = this;

                function compute_restoring() {
                    for (i = sidx; i < (sidx + size) && i < result.length; ++i) {
                        let msg: Message = {
                            id: '',
                            date: 0,
                            chat: null,
                            from: { id: result[i].user_id, is_bot: false, first_name: '' },
                            message: {
                                date: result[i].userSetup.nextPhotoTime
                            }
                        };

                        if (result[i].userSetup.nextPhotoTime
                            && moment(result[i].userSetup.nextPhotoTime).isAfter(moment())) {
                            self.logInfo(`restoring user:${result[i].user_id}`);
                            if (result[i].userSetup.type === self.CB_CHOICE[0].type) {
                                self.setSameHourSetting(msg, true, true, true);
                            } else {
                                self.setRandomHourSetting(msg, true, true, true);
                            }
                        } else {
                            self.logInfo(`restoring user and sending photo:${result[i].user_id}`);
                            msg.message.date = moment();
                            self.getPhotoV2(msg)
                                .catch(err => { self.logErr(err); });
                            if (result[i].userSetup.type === self.CB_CHOICE[0].type) {
                                self.setSameHourSetting(msg, true);
                            } else {
                                self.setRandomHourSetting(msg, true);
                            }
                        }
                    }

                    if (!(i >= result.length)) {
                        sidx += size;
                        process.nextTick(compute_restoring);
                    }
                }

                compute_restoring();
            });
    }

    private removeFirstItem(): void {
        if (this.imgsObj.lastUpdate) {
            if (this.imgsObj.scrapeInProgress) {
                this.logInfo(`Scrape in progress.`);
                return;
            }
            this.logInfo('removing first element...');
            if (this.imgsObj.imgs.length > 0) {
                this.imgsObj.imgs.shift();
            } else {
                this.logErr('imgs is empty.');
            }
        }
    }

    private intervalledTask() {
        setInterval(() => {
            this.removeFirstItem()
        },
            Config.IMGS_ARR_REFRESH
        );
        setInterval(() => {
            this.scrapeImg()
        }, Config.IMGS_REFRESH_TIME);
    }

    init() {
        this.setBotCommand();
        this.setBotListeners();
        this.scrapeImg();
        this.restoreUsersSetting();
        this.intervalledTask();
        this.bot.start();
    }
}

new FlickrExpored().init();