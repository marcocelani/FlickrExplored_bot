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
    }
}