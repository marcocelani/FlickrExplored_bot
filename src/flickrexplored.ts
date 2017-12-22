import * as telebot from 'telebot';
import * as rp from 'request-promise';
import * as async from 'async';
import * as htmlparser from 'htmlparser2';
import * as moment from 'moment';
import * as mongoose from 'mongoose';
import { Config } from './config';
import { FlickrConfig } from './flickrconfig';
import { IImgsCore } from './iimgscore'
import { IUserModel, UserModel } from './model/userModel';
import { IUserSettings } from './model/userSettings';
import { Model } from 'mongoose';
import { Message } from './model/message';
import { ITask } from './model/itask';

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
    private CB_CHOICE: Array<any> = [
        { type: 'sameHour', text: 'Every Day [same hour]' },
        { type: 'randomHour', text: 'Every Day [random hour]' },
        { type: 'deleteSetup', text: 'Remove setting.' }
    ];
    /**************************/
    constructor() {
        process.on('SIGINT', () => {
            if (Config.USEMONGO) {
                const self: FlickrExpored = this;
                mongoose.connection.close(() => {
                    self.logInfo('Mongoose default connection disconnected through app termination.');
                    process.exit(0);
                });
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
                user.getCount = 0;
                user.is_stopped = false;
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
                    if (!user)
                        await this.insertNewDoc(msg);
                    else
                        await this.userModel.update(
                            { user_id: msg.from.id },
                            { is_stopped: false },
                            (err, raw) => {
                                if (err) {
                                    this.logErr(err);
                                    return;
                                }
                            }
                        );

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
        this.setDBUser(msg)
            .then(() => {
                this.getPhotoV2(msg, false, true)
                    .then(() => {
                        this.sendMessage(msg, `${this.welcomeText(msg)}${this.usage()}`, { replyMarkup: this.getRateMarkUp() });
                    })
            });
    }

    private getPhotoV2(msg: Message,
        fromSetting?: boolean,
        isNewUser?: boolean): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            resolve();
        });
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
            this.resetSetting(msg, false);
        } else {
            console.log('Error in sendMessage:', err);
        }
    }

    private sendMessage(msg: Message, text: string, obj?: any): any {
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

    private getStats(msg: Message): string {
        return JSON.stringify({
            lastUpdate: this.imgsObj.lastUpdate,
            imgsLength: this.imgsObj.imgs.length,
            scrapeInProgress: this.imgsObj.scrapeInProgress
        }, null, 4);
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
            this.userModel.update(
                { user_id: msg.from.id },
                { is_stopped: true },
                (err, raw) => {
                    if (err) {
                        this.logErr(err);
                        return;
                    }
                    this.logInfo(`is_stopped flag set to false for ${this.getUserName(msg)}`);
                });
        }
        this.resetTime(msg);
        this.userModel[msg.from.id] = null;
        this.sendMessage(msg, `Bye, bye ${this.getUserName(msg)}`);
    }

    private setup(msg: Message): void {

    }

    private flickrSearch(msg: Message): void {

    }

    private flickrGeoSearch(msg: Message): void {

    }

    private setBotCommand() {
        this.bot.on('/start', (msg) => { this.getWelcome(msg); });
        this.bot.on('/photo', (msg) => { this.getPhotoV2(msg); });
        this.bot.on('/help', (msg) => { this.sendMessage(msg, this.usage()); });
        this.bot.on('/about', (msg) => { this.about(msg); });
        this.bot.on('/stats', (msg) => { this.sendMessage(msg, this.getStats(msg)); });
        this.bot.on('/stop', (msg) => { this.getStop(msg); });
        this.bot.on('/setup', (msg) => { this.setup(msg); });
        this.bot.on('inlineQuery', (msg) => { this.flickrSearch(msg); });
        this.bot.on('location', (msg) => { this.flickrGeoSearch(msg); });
    }

    private setBotListeners() {

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
                        let img_id = _img.split('_');
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
                            this.logErr(`Error in getPhotoIdsEngine:${err.name} -> ${err.statusCode}`);
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
                    const self : FlickrExpored = this;
                    function empty_waiting_room() {
                        while (item && count < 10) {
                            ++count;
                            this.getPhotoV2(item);
                            item = this.waitingRoom.pop();
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

    private restoreUsersSetting() {

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