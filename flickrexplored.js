const TeleBot = require('telebot');
const config = require('./config.js').config;
const rp = require('request-promise');
const async = require('async');
const htmlparser = require('htmlparser2');
const moment = require('moment');

const flickrObj = {
    ENDPOINT    : 'https://api.flickr.com/services/rest/',
    METHODS     : ['flickr.interestingness.getList', 'flickr.people.getInfo', 'flickr.photos.getInfo'],
    API_KEY     : config.FLICKR_KEY,
    EXTRAS      : ['path_alias'],
    PER_PAGE    : 1, /* Flickr max default: 500 */
    FORMAT      : 'json',
    NOJSONCB    : 1,
    FLICKR_EXPLORE_URL: 'https://www.flickr.com/explore/'
};

/** Core Data Structure **/
var imgsObj = {
    lastUpdate : null,
    imgs: [],
    scrapeInProgress: false
};
/*************************/

var about = function(){
    return `${config.APP_NAME} made by @${config.TELEGRAM_USERNAME}.`;
};

var usage = function() {
    return `Type /photo for pick a photo.
Type /help for show help.
Type /about for show info.`; 
};

var getWelcome = function(firstName) {
   return `Welcome ${(firstName) ? firstName : ''}!
My mission is to show you Flickr's Explored photos in a randomic way.
${usage()}`;
};

/* get randomic number between 0 and max. */
var getRandomic = function(upperBound){
    if(upperBound && typeof(upperBound) !== 'number')
        return 0;
    let min = 0; //choose your lowerBound if you want.
    let max = Math.floor(upperBound);
    return Math.floor(Math.random() * (max - min)) + min;
};

var replyError = function(msg){
    msg.reply.text(`Something goes wrong.`);
};

var getMsgError = function(response){
    if(response){
        return `Something goes wrong. Flickr response:${response.message}, code:${response.code}`;
    }
    return '';
};

var log = function(type, msg){
    if(!type)
        type = 'INFO';
    console.log(`[${type}][${moment().format('DD/MM/YYYY hh:mm:ss')}] ${msg}`);
};

var logInfo = function(msg){
    log('INFO', msg);
};

var logErr = function(msg){
    log('ERR', msg);
};

var scrapeEngine = function(name, attribs, imgsArr){
    if(name === 'div' 
        && attribs.style)
    {
        let tokens = attribs.style.split(':');
        for(let i=0; i<tokens.length; ++i){
            let token = tokens[i].trim();
            if(token.includes('url')
                && token.length > 4)
            {
                let img_url = token.substring(4, token.length - 1);
                if(img_url.endsWith('.jpg')
                    || img_url.endsWith('.JPG'))
                {
                    let img = img_url.split('/');
                    if(img.length == 0) {
                        logErr('img has no length.');
                        return;
                    }
                    img = img[img.length-1];
                    let img_id = img.split('_');
                    if(img_id.length == 0){
                        logErr('img_id has no length.');
                        return;
                    }
                    imgsArr.push(img_id[0]);
                }
            }
        }
    }
}

var getPhotoIdsEngine = function(rpObj, dateStr, task_id){
    if(!rpObj){
        return function(cb){
            cb(new Error(`Wrong rpObj.`));
        };
    }
    return function(cb) {
        logInfo(`task ${task_id} started.`)
        let imgsArr = [];
        let parser = new htmlparser.Parser(
        {
           onopentag: function(name, attribs){
               scrapeEngine(name, attribs, imgsArr);
           }
        });
        rp(rpObj)
        .then( response => {
            parser.write(response);
            parser.end();
            logInfo(`task ${task_id} ended.`);
            cb(null, { date: dateStr, imgsArr: imgsArr });
        })
        .catch( err => {
            console.log(err);
            cb(err);
        });
    };
};

var scrapeImg = function() {
    if(imgsObj.scrapeInProgress){
        logInfo(`Another scrape is in progress.`);
        return;
    }
    let mDate = moment(new Date());

    if(imgsObj.lastUpdate){
        if(mDate.format('YYYY/DD/MM') === imgsObj.lastUpdate.format('YYYY/DD/MM')) {
            logInfo(`Skipping same day update.`);
            return;
        }
    }

    imgsObj.scrapeInProgress = true;

    let flickrUrlsArr = [];
    let dayBefore = config.DAY_BEFORE - imgsObj.imgs.length;
    if(dayBefore < 0){
        logErr(`dayBefore:${dayBefore}. Negative values found. I'm restoring imgs array.`);
        imgsObj.imgs = [];
        dayBefore = config.DAY_BEFORE;
    }
    if(dayBefore != 0){
        logInfo(`imgs needs update. dayBefore:${dayBefore}`)
        let tasksArr = [];
        for(let i=0; i<dayBefore; ++i) {
            mDateStr = mDate.subtract(1, 'days').format('YYYY/MM/DD');
            tasksArr.push(getPhotoIdsEngine({ uri : flickrObj.FLICKR_EXPLORE_URL + 
                                                    mDateStr }, mDateStr, i));
        }
        logInfo('starting parallel tasks...');
        async.parallelLimit(tasksArr, 2,
            function(err, result){  
                if(err){
                    logErr(`Something goes wrong:${err.message}.`);
                    imgsObj.scrapeInProgress = false;
                    return;
                }
                logInfo(`tasksArr ended.`);
                for(let i=result.length-1; i>=0; --i){
                    imgsObj.imgs.push(result[i]);
                }
                imgsObj.lastUpdate = moment();
                imgsObj.scrapeInProgress = false;
            }
        );
    } 
};

var getPhotoV2 = function(msg){
    if(imgsObj.imgs.length == 0){
        logErr(`imgs is empty`);
        return;
    }

    let imgsIds;
    let img_id;
    if(imgsObj.imgs.length > 0){
        imgsIds = imgsObj.imgs[getRandomic(imgsObj.imgs.length - 1)];
        if(imgsIds.imgsArr.length > 0 ){
            img_id = imgsIds.imgsArr[getRandomic(imgsIds.imgsArr.length - 1)];
        }
        else {
            logErr(`imgsIds is empty.`);
            replyError(msg);
            return;
        }
    }
    else {
        logErr(`imgs is empty.`);
        replyError(msg);
        return;
    }
    

    rpOpt = {
        uri: flickrObj.ENDPOINT,
        qs: {
                method: flickrObj.METHODS[2],
                api_key: flickrObj.API_KEY,
                photo_id: img_id,
                format: flickrObj.FORMAT,
                nojsoncallback: flickrObj.NOJSONCB,
        },
        json: true
    };
    
    rp(rpOpt)
    .then( response => {
        if(response.stat === 'fail'){
            msg.reply.text(getMsgError(response));
            return;
        }
        if(response.photo
            && response.photo.urls
            && response.photo.urls.url 
            && response.photo.urls.url[0]
            && response.photo.urls.url[0]._content) {
                msg.reply.text(response.photo.urls.url[0]._content);
            } else {
                replyError(msg);
                logErr(console.log(response));
            }
    }).catch(err => {
        logErr(err.message);
        replyError(msg);
    });
};

var removeFirstItem = function() {
    if(imgsObj.lastUpdate){
        if(imgsObj.lastUpdate.format('YYYY/DD/MM') !== moment().format('YYYY/DD/MM')) {
            if(imgsObj.scrapeInProgress){
                logInfo(`Scrape in progress.`);
                return;
            }
            logInfo('Removing first element.');
            if(imgsObj.imgs.length > 0){
                imgsObj.imgs.pop();
            } else {
                logErr('imgs is empty.');
            }       
        }
    }
};

var getStats = function(){
    return JSON.stringify({ lastUpdate: imgsObj.lastUpdate, 
                            imgsLength: imgsObj.imgs.length,
                            scrapeInProgress : imgsObj.scrapeInProgress}, null, 4);
};

var getBot = function(){
    let botOpt = {
        token: config.BOT_TOKEN,
    };
    if(config.ENABLE_WEBHOOK
        && config.ENABLE_WEBHOOK === true)
    {
        botOpt.webhook = {};
        botOpt.webhook.key = config.WEBHOOK.key;
        botOpt.webhook.cert = config.WEBHOOK.cert;
        botOpt.webhook.url = config.WEBHOOK.url;
        botOpt.webhook.host = config.WEBHOOK.host;
        botOpt.webhook.port = config.WEBHOOK.port;

    } else {
        botOpt.polling = {
            interval : config.POLLING.interval
        };
    }
    return new TeleBot(botOpt);
};

var setBotCommand = function(){
    bot.on(['/start'], (msg) =>  msg.reply.text(getWelcome(msg.from.first_name)));
    bot.on(['/photo'], (msg) => getPhotoV2(msg) );
    bot.on('/help', (msg) => msg.reply.text(usage()));
    bot.on('/about', (msg) => msg.reply.text(about()));
    bot.on('/stats', (msg) => msg.reply.text(getStats()));
};

const bot = getBot();

var init = function(){
    
    setBotCommand();
    bot.start();

    scrapeImg();

    setInterval(() => {
        removeFirstItem()
    },
        config.IMGS_ARR_REFRESH
    );
    setInterval(() => {
        scrapeImg()
    },config.IMGS_REFRESH_TIME)
};

init();
