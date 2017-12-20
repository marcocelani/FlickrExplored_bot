import * as telebot from 'telebot';
import * as rp from 'request-promise';
import * as async from 'async';
import * as htmlparser from 'htmlparser2';
import * as moment from 'moment';
import * as mongoose from 'mongoose';
import { Config } from './config';
import { FlickrConfig } from './flickrconfig';
import { IImgsCore } from './iimgscore'

class FlickrExpored {
    private bot: telebot;
    /** Core Data Structure [for imgs]**/
    private imgsObj: IImgsCore;
    /*************************/
    /* Users settings DS     */
    /*************************/
    private usersSettings: any = {};
    /*************************/
    /* Users that are waiting for photo.
    /*************************/
    constructor() {
        this.bot = new telebot(Config.TELEBOT_OPT);
    }

    private getUserName(msg: any): string {
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

    private getWelcome(msg: any): void {
        new Promise<void>(
            (resolve) => {

            }
        ).then(
            () => {
                this.getPhotoV2(msg, false, true)
                    .then(() => {
                        this.sendMessage(msg, `${this.welcomeText(msg)}${this.usage()}`, { replyMarkup: this.getRateMarkUp() });
                    })
            });
    }

    private getPhotoV2(msg: any,
        fromSetting?: boolean,
        isNewUser?: boolean): Promise<void> {
        return new Promise<void>((resolve, reject) => {

        });
    }

    private isFromGroup(msg: any): boolean {
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
            console.log(`[${type}][${moment().format('DD/MM/YYYY HH:mm:ss')}] ${mex.message}`);
        else
            console.log(`[${type}][${moment().format('DD/MM/YYYY HH:mm:ss')}] ${mex}`);
    }

    private resetTime(msg: any): void {
        if(this.usersSettings[msg.from.id] 
            && this.usersSettings[msg.from.id].scheduledTimer){
            clearTimeout(this.usersSettings[msg.from.id].scheduledTimer);
        }
    }

    private removeUserDBSetting(msg: any): void {

    }

    private resetSetting(msg: any, msgSend: boolean): void {
        this.resetTime(msg);
        this.removeUserDBSetting(msg);
        this.usersSettings[msg.from.id] = null;
        if (msgSend)
            this.sendMessage(msg, `Setting removed.`);
    }

    private manageSendError(err: any, msg: any) {
        if (err && err.error_code && err.error_code == 403) {
            this.logInfo(`${this.getUserName(msg)} has stopped and blocked the bot.`);
            this.resetSetting(msg, false);
        } else {
            console.log('Error in sendMessage:', err);
        }
    }

    private sendMessage(msg: any, text: string, obj?: any): any {
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

    private getStats(msg: any): string {
        return JSON.stringify({
            lastUpdate: this.imgsObj.lastUpdate,
            imgsLength: this.imgsObj.imgs.length,
            scrapeInProgress: this.imgsObj.scrapeInProgress
        }, null, 4);
    }

    private about(msg: any): void {
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

    private getStop(msg: any): void {

    }

    private setup(msg: any): void {

    }

    private flickrSearch(msg: any): void {

    }

    private flickrGeoSearch(msg: any): void {

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

    private scrapeImg() {

    }

    private restoreUsersSetting() {

    }

    private intervalledTask() {

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