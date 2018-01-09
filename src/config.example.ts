import * as telebot from 'telebot';

export class Config {
    public static readonly APP_NAME : string = 'APP_NAME';
    public static readonly TELEGRAM_USERNAME : string = 'USERNAME';
    public static readonly RATE_URL : string = 'http://...';
    public static readonly TELEBOT_OPT : telebot.config = {
        token: '',
        polling : {
            interval : 3 * 1000
        }
    };
    public static readonly USEMONGO : boolean = false;
    public static readonly MONGO_URI = 'mongodb://localhost:27017/YOURDB';
    public static readonly MONGO_USR_COLL = 'COLL';
    public static readonly IMGS_ARR_REFRESH : number = (1000 * 60 * 60 * 23.9);
    public static readonly IMGS_REFRESH_TIME : number = (1000 * 60 * 60 * 24);
    public static readonly USERS_SETTING_CHECK : number = (1000 * 60 * 60 /* * 1 */);
    public static readonly DAY_BEFORE : number = 56;
}