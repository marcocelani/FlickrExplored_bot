const TeleBot = require('telebot');
const config = require('./config.js').config;
const rp = require('request-promise');
const async = require('async');
const htmlparser = require('htmlparser2');
const moment = require('moment');
const MongoClient = require('mongodb').MongoClient;

const flickrObj = {
    ENDPOINT    : 'https://api.flickr.com/services/rest/',
    METHODS     : ['flickr.interestingness.getList', 
                   'flickr.people.getInfo',
                   'flickr.photos.getInfo',
                   'flickr.photos.search'
                  ],
    API_KEY     : config.FLICKR_KEY,
    EXTRAS      : ['path_alias',
                   '',
                   '',
                   'can_comment,count_comments,count_faves,description,isfavorite,license,media,needs_interstitial,owner_name,path_alias,realname,rotation,url_c,url_l,url_m,url_n,url_q,url_s,url_sq,url_t,url_z'
                ],
    PER_PAGE    : [1, -1, -1, config.MAX_SEARCH_ITEM], /* Flickr max default: 500 */
    PAGE        : [-1, -1, -1, 1],
    SORT        : ['', '', '', 'relevance'],
    PARSE_TAG   : ['', '', '', '1'],
    CONTENT_TYPE: ['', '', '', '1'],
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
/* Users settings DS     */
/*************************/
var usersSettings = {};
/*************************/
/* Users that are waiting for photo.
/*************************/
var waitingRoom = [];

var CB_CHOICE = [ 
                  { type:'sameHour', text:'Every Day [same hour]'}, /* NOT USED */
                  { type: 'randomHour', text: 'Every Day' },
                  { type: 'deleteSetup', text: 'Remove setting.'}
                ];
/**************************/

var about = function(msg){
    let replyMarkup = bot.inlineKeyboard(
        [
            [
                bot.inlineButton(`GitHub repository`, { url: 'https://github.com/marcocelani/FlickrExplored_bot'})
            ]
        ]
    );
    return sendMessage(msg, `${config.APP_NAME} made by @${config.TELEGRAM_USERNAME}.`, { replyMarkup }); 
};

var usage = function() {
    return `Type /photo for pick a photo.
Type /setup for setting some options.
Type /help for showing help.
Type /about for showing info.
Type /stop for stopping.`; 
};

var insertNewDoc = function(db, coll, msg, updateGetCount) {
    let toBeInsertedObj = msg.from;
    toBeInsertedObj.getCount = (updateGetCount) ? 1 : 0;
    toBeInsertedObj.commands = [];
    toBeInsertedObj.commands.push({ cmd : '/start', date : moment() });
    coll.insertOne(toBeInsertedObj, (err, r) => {
        if(err){
            logErr(err.message);
            db.close();
            return;
        }
        if(r.insertedCount === 1){
            logInfo(`New user @${toBeInsertedObj.username} added.`);
            db.close();
        } else {
            logErr(`No record inserted.`);
            db.close();
        }
    });
};

var updateUserStatus = function(db, coll, doc){
    coll.updateOne(
        {_id: doc._id},
        { $push: { commands: { cmd: '/start', date: moment() }}},
        (err, result) => {
            if(err){
                logErr(err.message);
            } else {
                logInfo(`User @${doc.username}: /start command updated.`);
            }
            db.close();
        }
    );
};

var updateGetCount = function(db, coll, doc){
    coll.updateOne(
        {_id: doc._id},
        {$inc : { getCount: 1 }},
        (err, result) => {
            if(err){
                logErr(`Error in updateGetCount:${err.message}`);
            } else {
                logInfo(`User @${doc.username}: getCount field updated`);
            }
            db.close();
        }
    );
};

var getWelcome = function(msg) {
    async.waterfall(
        [
            getDB(),
            getCollection(),
            findOne(msg),
            (db, coll, doc, cb) => {
                if(!doc){
                    insertNewDoc(db, coll, msg);
                    cb(null, null);
                } else {
                    updateUserStatus(db, coll, doc);
                    cb(null, null);
                }
            }
        ],
        function(err, result){
            msg.reply.text(`Welcome ${(msg.from.username) ? msg.from.username : ''}!
My mission is to show you Flickr's Explored photos in a randomic way.
${usage()}`);
        }
    );
};

var stopBot = function(db, coll, doc){
    coll.updateOne(
        {_id: doc._id},
        { $push: { commands: { cmd: '/stop', date: moment() } }, $set: { userSetup: null } },
        (err, result) => {
            if(err){
                logErr(`Error in stopBot:${err.message}`);
            } else {
                logInfo(`User @${doc.username}: /stop command updated`);
            }
            
            db.close();
        }
    );
};

var getStop = function(msg){
    async.waterfall(
        [
            getDB(),
            getCollection(),
            findOne(msg),
            (db, coll, doc, cb) => {
                if(doc){
                    stopBot(db, coll, doc);
                    cb(null, true);
                    return;
                }
                cb(null, false);
            }
        ],
        (err, result) => {
            if(result === true){
                resetTime(msg);
                usersSettings[msg.from.id] = null;
                msg.reply.text(`Bye bye ${msg.from.username}`);
            }
            else {
                msg.reply.text(`You never starts bot.`);
            }
        }
    );
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
    return sendMessage(msg, `Something goes wrong.`);
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
    console.log(`[${type}][${moment().format('DD/MM/YYYY HH:mm:ss')}] ${msg}`);
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

var getRandomSecond = function(){
    return getRandomic( ((config.TASK_DELAY || config.TASK_DELAY > 0) ? config.TASK_DELAY : 60) * 1000);
};

var scrapeImg = function() {
    if(imgsObj.scrapeInProgress){
        logInfo(`Another scrape is in progress.`);
        return;
    }
    
    imgsObj.scrapeInProgress = true;
    
    let mDate = moment().subtract(1, 'days');

    if(imgsObj.lastUpdate){
        if(mDate.format('YYYY/DD/MM') === imgsObj.lastUpdate.format('YYYY/DD/MM')) {
            logInfo(`Skipping same day update.`);
            return;
        }
    }

    let flickrUrlsArr = [];
    let dayBefore = config.DAY_BEFORE - imgsObj.imgs.length;
    if(dayBefore < 0){
        logErr(`dayBefore:${dayBefore}. Negative values found. I'm restoring imgs array.`);
        imgsObj.imgs = [];
        dayBefore = config.DAY_BEFORE;
    }
    if(dayBefore != 0){
        logInfo(`imgs needs update. dayBefore:${dayBefore}`)
        let mDateStr = mDate.format('YYYY/MM/DD');

        let rpOptArr = [];
        for(let i=0; i<dayBefore; ++i){
            rpOptArr.push({ task_id: i, 
                            dateStr: mDateStr,
                            rpOpt: { uri : flickrObj.FLICKR_EXPLORE_URL + mDateStr } 
                        });
            mDateStr = mDate.subtract(1, 'days').format('YYYY/MM/DD');            
        }
        
        logInfo('starting parallel tasks...');        
        async.eachLimit(rpOptArr, 2, 
            (rpOptItem, cb) => {
                if(!rpOptItem.rpOpt){
                    cb(new Error(`Wrong rpOpt.`));
                    return;
                }

                logInfo(`task ${rpOptItem.task_id} started.`)
                let imgsArr = [];
                let parser = new htmlparser.Parser(
                {
                    onopentag: function(name, attribs){
                        scrapeEngine(name, attribs, imgsArr);
                    }
                });

                rp(rpOptItem.rpOpt)
                .then( response => {
                    parser.write(response);
                    parser.end();
                    logInfo(`task ${rpOptItem.task_id} ended.`);
                    imgsObj.imgs.push({ date: rpOptItem.dateStr, imgsArr: imgsArr });
                    cb(null);
                })
                .catch( err => {
                    logErr(`Error in getPhotoIdsEngine:${err.message} -> ${err.StatusCodeError}`);
                    cb(null);
                });
            }, 
            (err) => {
                if(err){
                    logErr(`Something goes wrong:${err.message}.`);
                }
                imgsObj.lastUpdate = moment();
                imgsObj.scrapeInProgress = false;
                logInfo('Tasks completed.');
                
                let count = 0;
                let item = waitingRoom.pop();
                
                if(item)
                    logInfo('Empty the waiting room.');                
                
                function empty_waiting_room(){
                    while(item && count < 10){
                        ++count;
                        getPhotoV2(item);
                        item = waitingRoom.pop();
                    }

                    if(item){
                        count = 0;
                        process.nextTick(empty_waiting_room);
                    } else {
                        logInfo('Waiting room is empty.');                                        
                    }
                }

                empty_waiting_room();
            }
        );
    } 
};

var getPhotoUrlFromId = function(img_id) {
    return function(cb){
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
                cb(null, { stat: 'fail', message: getMsgError(response) });
            } else {
                if(response.photo
                    && response.photo.urls
                    && response.photo.urls.url 
                    && response.photo.urls.url[0]
                    && response.photo.urls.url[0]._content) 
                {
                    cb(null, { stat: 'ok', 
                               url: response.photo.urls.url[0]._content,
                               url_physic_z: getPhysicUrl(
                                                         response.photo.farm, 
                                                         response.photo.server,
                                                         response.photo.id,
                                                         response.photo.secret,
                                                         'z'
                                                        )
                             });
                } else {
                    cb(null, { stat: 'fail', message: 'wrong response.'});
                }
            }
        }).catch(err => {
            logErr(err.message);
            cb(err);
        });
    }
};

var getPhotoV2 = function(msg, fromSetting){
    async.waterfall(
        [
            getDB(),
            getCollection(),
            findOne(msg),
            (db, coll, doc, cb) => {
                if(!doc){
                    insertNewDoc(db, coll, msg, true);
                    cb(null, null);
                } else {
                    updateGetCount(db, coll, doc);
                    cb(null, null);
                }
            }
        ],
        function(err, result){
            if(imgsObj.scrapeInProgress){
                //Go to waiting room.
                waitingRoom.push(msg);
                logInfo(`user ${msg.from.id} into waiting room.`);
                return;
            }
            if(imgsObj.imgs.length == 0){
                logErr(`imgs is empty`);
                sendMessage(msg, `Images not available at moment. Please try later.`);
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
    
            async.waterfall(
                [
                    getPhotoUrlFromId(img_id)                    
                ],
                (err, result) => {
                    if(err){
                        replyError(msg);
                        return;
                    }
                    if(result.stat === 'fail'){
                        replyError(msg);
                        console.log(result);
                        return;
                    }

                    sendMessage(msg, result.url);

                    if(fromSetting)
                        sendMessage(msg, `Done. Next photo on ${usersSettings[msg.from.id].nextPhotoTime.format('DD/MM/YYYY HH:mm')} UTC.`);
                }
            );
        }
    );
};

var setupText = function() {
return `You can setup this bot for getting photo automatically.  
You don't have any setting yet. Please make a choice.`
};

var getNoDataInlineKeyBoard = function() {
    return bot.inlineKeyboard(
        [
            // [
            //     bot.inlineButton(CB_CHOICE[0].text, { callback: CB_CHOICE[0].type }),
            // ],
            [
                bot.inlineButton(CB_CHOICE[1].text, { callback: CB_CHOICE[1].type })
            ],
            /* TODO */
            /*[
                bot.inlineButton('Every Day [custom hour]', {callback: 'TODO'})
            ]*/
        ]
    );
};

/* NOT USED */
var getSameHourInlineKeyBoard = function(){
    return bot.inlineKeyboard(
        [
            [
                bot.inlineButton(CB_CHOICE[1].text, { callback: CB_CHOICE[1].type } )
            ],
            [
                bot.inlineButton(CB_CHOICE[2].text, { callback: CB_CHOICE[2].type })
            ]
        ]
    );
};

var getRandomHourInlineKeyBoard = function() {
    return bot.inlineKeyboard(
        [
            // [
            //     bot.inlineButton(CB_CHOICE[0].text, { callback: CB_CHOICE[0].type } )
            // ],
            [
                bot.inlineButton(CB_CHOICE[2].text, { callback: CB_CHOICE[2].type } )
            ]
        ]
    );
};

/* NOT USED */
var setupSameHourText = function() {
    return `You have... same hour...`;
};

var setupRandomHourText = function(msg) {
    //console.log(usersSettings[msg.from.id]);
    return `Next photo on:${moment(usersSettings[msg.from.id].nextPhotoTime).format('DD/MM/YYYY HH:mm')}`;
};

var setup = function(msg) {
    if(msg.chat.type === 'group' 
        || msg.chat.type === 'supergroup'
        || msg.chat.type === 'channel')
    {
        sendMessage(msg, `Setup command not allowed in groups.`); /* TODO? I don't know. */
        return;
    }
    async.waterfall(
        [
            getDB(),
            getCollection(),
            findOne(msg),
            (db, coll, doc, cb) => {
                if(!doc){
                    insertNewDoc(db, coll, msg, true);
                    cb(null, null);
                } else {
                    cb(null, null);
                }
            }
        ],
        function(err, result){
            if(err){
                console.log(err);
            }
            if(!usersSettings[msg.from.id]){
                let replyMarkup = getNoDataInlineKeyBoard();
                sendMessage(msg, setupText(),  { replyMarkup } );
            }
            // else if(usersSettings[msg.from.id].type === CB_CHOICE[0].type){ /* same hour */
            //     let replyMarkup = getSameHourInlineKeyBoard();
            //     sendMessage(msg, setupSameHourText(), { replyMarkup } );
            // }
            else if(usersSettings[msg.from.id].type === CB_CHOICE[1].type){ /* random hour */
                let replyMarkup = getRandomHourInlineKeyBoard();
                sendMessage(msg, setupRandomHourText(msg), { replyMarkup } );
            }
        }
    );
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

var getStats = function(msg){
    return JSON.stringify({ lastUpdate: imgsObj.lastUpdate, 
                            imgsLength: imgsObj.imgs.length,
                            scrapeInProgress : imgsObj.scrapeInProgress}, null, 4);
};

var getBot = function(){
    let botOpt = {
        token: config.BOT_TOKEN,
        usePlugins: ['floodProtection'],
        pluginConfig: {
            floodProtection: {
                interval: 5,
                message: 'Too many messages, relax!'
            }
        }
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

var findOneAndUpdateUserSetting = function(msg, userObj){
    return function(db, coll, cb){
        coll.findOneAndUpdate(
            { id: msg.from.id },
            { $set: { userSetup : (userObj) ? { nextPhotoTime: userObj.nextPhotoTime, type: userObj.type } : null } },
            function(err, obj){
                if(err){
                    cb(err);
                } else {
                    cb(null);
                }
                db.close();
            }
        );
    }
};

var updateUserDBSetting = function(msg, userObj) {
    async.waterfall(
        [
            getDB(),
            getCollection(),
            findOneAndUpdateUserSetting(msg, userObj)
        ],
        function(err, result){
            if(err){
                logErr(err.message);
                console.log(err);
            }
        }
    );
};

var removeUserDBSetting = function(msg){
    async.waterfall(
        [
            getDB(),
            getCollection(),
            findOneAndUpdateUserSetting(msg, null)
        ],
        function(err, result){
            if(err){
                console.log(err);
            }
        }
    );
};

var getUserObj = function(type) {
    return {
        type: type
    };
};

var getTotMillis = function(userObj){
    let totMillis = userObj.nextPhotoTime.valueOf() - moment().valueOf();
    if(totMillis < 0 || isNaN(totMillis) || !isFinite(totMillis))
        totMillis = 60 * 1000 * 24;
    return totMillis;
};

var getRandomicTimeHour = function(date){
    if(!date)
        return moment().add(1, 'day').hours(0).add(getRandomic(24) + 1, 'hours');
    return date.add(1, 'day').hours(0).add(getRandomic(24) + 1, 'hours');
};

var settingInterval = function(msg, totMillis){
    return setTimeout(function(){
        getPhotoV2(msg);
        if(usersSettings[msg.from.id]){
            setRandomHourSetting(msg, true);
        }
    }, totMillis, msg);
};

var resetTime = function(msg){
    if(usersSettings[msg.from.id] && usersSettings[msg.from.id].scheduledTimer){
        clearTimeout(usersSettings[msg.from.id].scheduledTimer);
    }
};

var setRandomHourSetting = function(msg, hideMessage, restoring, noDBUpdate){
    resetTime(msg);
    let userObj = getUserObj(CB_CHOICE[1].type);
    
    let userDate = moment(msg.message.date).toDate();
    if(!restoring)
        userObj.nextPhotoTime = getRandomicTimeHour(moment()); //userDate.add(1, 'day');//.add(getRandomic(24 - userDate.hours()) + 1, 'hours');
    else {
        userObj.nextPhotoTime = moment(userDate);
    }

    let totMillis = getTotMillis(userObj);

    if(!noDBUpdate)
        updateUserDBSetting(msg, userObj);

    usersSettings[msg.from.id] = userObj;    
    userObj.scheduledTimer = settingInterval(msg, totMillis);
    
    if(!hideMessage
        && !restoring 
        && !noDBUpdate)
    {

        getPhotoV2(msg, true);
    }
    
    if(hideMessage && restoring)
        logInfo(`user ${msg.from.id} restored.`);

};

/* NOT USED */
var setSameHourSetting = function(msg) {
    resetTime(msg);
    let userObj = getUserObj();
    let totMillis = getTotMillis(userObj);

    userObj.scheduledTimer = settingInterval(msg, totMillis);

    usersSettings[msg.from.id] = userObj;
    updateUserDBSetting(msg, userObj);

    sendMessage(msg, `Done. Next photo on ${userObj.nextPhotoTime.format('DD/MM/YYYY HH:mm')}`);
};

var resetSettting = function(msg, userObj){
    resetTime(msg);
    removeUserDBSetting(msg);
    usersSettings[msg.from.id] = null;
    sendMessage(msg, `Setting removed.`);
};

var restoreUsersSetting = function() {
    async.waterfall(
        [
            getDB(),
            getCollection(),
            (db, coll, cb) => {
                coll.find({ userSetup : { $ne: null } })
                    .toArray(function(err, docs){
                        if(err){
                            logErr(`Error in restoreUsersSeting:${err.message}`);
                            cb(err);
                        } else {
                            cb(null, docs);
                        }
                        db.close();
                    });
            },
        ],
        (err, result) => {
            if(err){
                console.log(err);
                return;
            }

            /* splitting */
            let sidx = 0;
            let size = 10;
            let i = 0;

            function compute_restoring() {
                for(i = sidx; i < (sidx + size) && i < result.length; ++i){
                    let msg = { 
                        from: { id : result[i].id },
                        message : { 
                            date: result[i].userSetup.nextPhotoTime
                        }
                    };

                    if(moment.isMoment(result[i].userSetup.nextPhotoTime)
                        && moment(result[i].userSetup.nextPhotoTime).isAfter(moment()))
                    {
                        logInfo(`restoring user:${result[i].id}`);
                        setRandomHourSetting(msg, true, true, true);
                    } else {
                        logInfo(`restoring user and sending photo:${result[i].id}`);
                        msg.message.date = moment();
                        getPhotoV2(msg);                        
                        setRandomHourSetting(msg, true);
                    }
                }

                if(!(i >= result.length))
                {
                    sidx += size;
                    process.nextTick(compute_restoring);
                }
            }

            compute_restoring();
        }
    );
};

var buildUrlArr = function(photo){
    let url_arr = [];
    if(photo.width_m && photo.height_m)
        url_arr.push({url: photo.url_m, width: photo.width_m, height: photo.height_m });
    if(photo.width_n && photo.height_n)
        url_arr.push({url: photo.url_n, width: photo.width_n, height: photo.height_n });
    if(photo.width_z && photo.height_z)
        url_arr.push({url: photo.url_z, width: photo.width_z, height: photo.height_z });
    if(photo.width_c && photo.height_c)
        url_arr.push({url: photo.url_c, width: photo.width_c, height: photo.height_c });
    if(photo.width_l && photo.height_l)
        url_arr.push({url: photo.url_l, width: photo.width_l, height: photo.height_l });
    if(photo.width_o && photo.height_o)
        url_arr.push({url: photo.url_o, width: photo.width_o, height: photo.height_o });
    return url_arr;
};

var getPhysicUrl = function(farm_id, server_id, id, secret, size){
    if(!size)
        return `https://farm${farm_id}.staticflickr.com/${server_id}/${id}_${secret}.jpg`;
    else 
        return `https://farm${farm_id}.staticflickr.com/${server_id}/${id}_${secret}_${size}.jpg`;
};

var flickrSearch = function(msg) {
    if(!msg)
        return;

    let isGeoSearch = msg.location          && 
                      msg.location.latitude && 
                      msg.location.longitude;

    let query = '';
    if(!isGeoSearch){
        query = msg.query.trim();
    }

    const answers = bot.answerList(msg.id, {cacheTime: 60});

    if(query === '' 
       && imgsObj.imgs.length > 0
       && !isGeoSearch)
    {
        let idArr = imgsObj.imgs[getRandomic(imgsObj.imgs.length - 1)].imgsArr;
                           
        async.each(idArr,
            (id, cb) => {
                async.waterfall(
                    [
                        getPhotoUrlFromId(id)                    
                    ],
                    (err, result) => { 
                        if(result.stat === 'fail'){
                            console.log(result);
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
                if(err){
                    console.log(err);
                    return;
                }
                bot.answerQuery(answers)
                .then( result => { })
                .catch( err => { console.log(`[${moment().format('DD/MM/YYYY HH:mm')}] flickrSearchErr:`, err); });
            }
        );

        return;
    }

    const INDEX = 3;

    var rpObj = {
        uri: flickrObj.ENDPOINT,
        qs: {
            method: flickrObj.METHODS[INDEX],
            api_key: flickrObj.API_KEY,
            text: query,
            sort: flickrObj.SORT[INDEX],
            parse_tag: flickrObj.PARSE_TAG[INDEX],
            content_type: flickrObj.CONTENT_TYPE[INDEX],
            extras: flickrObj.EXTRAS[INDEX],
            per_page: flickrObj.PER_PAGE[INDEX],
            page: flickrObj.PAGE[INDEX],
            format: flickrObj.FORMAT,
            nojsoncallback: flickrObj.NOJSONCB, 
        },
        json: true
    };

    if(isGeoSearch)
    {
        rpObj.qs.lat = msg.location.latitude;
        rpObj.qs.lon = msg.location.longitude;
        rpObj.qs.per_page = 5;
    }
    
    rp(rpObj)
    .then(response => {
        if(response.stat === 'fail'){
            logErr(getMsgError(response));
            return;
        }
        
        let photosArr = response.photos.photo;
        
        if(!photosArr)
            return;

        async.each(photosArr,
            (photo, cb) => {
                async.waterfall(
                    [
                        getPhotoUrlFromId(photo.id)                    
                    ],
                    (err, result) => { 
                        if(result.stat === 'fail'){
                            console.log(result);
                            cb(null);
                            return;
                        }
                        
                        let url_arr = buildUrlArr(photo);
                        if(url_arr.length == 0) {
                            cb(null);
                            return;
                        }
                        
                        if(!isGeoSearch){
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
                            sendMessage(msg, result.url)
                        }

                        cb(null);
                    });
            },
            (err) => {
                if(!isGeoSearch){
                    bot.answerQuery(answers)
                    .then( result => { })
                    .catch( err => { console.log(`[${moment().format('DD/MM/YYYY HH:mm')}] flickrSearchErr:`, err); });
                }   
            }  
        );
    });
}

var setBotListeners = function() {
    bot.on('callbackQuery', msg => {
        if(msg.data === CB_CHOICE[0].type){ /* same hour */
            //setSameHourSetting(msg); /* not used */
        } else if(msg.data === CB_CHOICE[1].type){ /* random hour */
            setRandomHourSetting(msg);
        } else if(msg.data === CB_CHOICE[2].type){ /* reset */
            resetSettting(msg);
        } else {
            sendMessage(msg.from.id, `Wrong choice: ${ msg.data }`);
        }
    });
};

var setBotCommand = function(){
    bot.on('/start', (msg) =>  getWelcome(msg));
    bot.on('/photo', (msg) => getPhotoV2(msg) );
    bot.on('/help', (msg) => msg.reply.text(usage()));
    bot.on('/about', (msg) => about(msg));
    bot.on('/stats', (msg) => msg.reply.text(getStats(msg)));
    bot.on('/stop', (msg) => getStop(msg));
    bot.on('/setup', (msg) => setup(msg));
    bot.on('inlineQuery', (msg) => flickrSearch(msg) );
    bot.on('location', (msg) => { flickrSearch(msg); });
};

var getDB = function() {
    return function(cb){
        if(!config.ENABLE_MONGODB 
            || config.ENABLE_MONGODB === false)
        {
            cb(new Error(`MongoDB is disabled.`));
            return;
        }
        MongoClient.connect(config.MONGODB.connectionStr, (err, db) => {
            if(err) {
                logErr(err.message);
                cb(err);
                return;
            } else {
                cb(null, db);
            }
        });
    }
};

var getCollection = function() {
    return function(db, cb){
        db.collection(config.MONGODB.usersCollection, (err, coll) => {
            if(err){
                logErr(`getCollection error:${err.message}`);
                console.log(err);
                db.close();
                return;
            }
            cb(null, db, coll);
        })
    }
};

var findOne = function(msg){
    return function(db, coll, cb) {
        coll.findOne({ id : msg.from.id }, (err, doc) => {
            if(err){
                logErr(`Error in findOne:${err.message}`);
                db.close();
                return;
            }
            cb(null, db, coll, doc);
        });
    }
};

var sendMessage = function(msg, text, obj){
    let id = -1;
    if(!msg && !msg.chat && !msg.chat.type)
        return;
    if(
        msg.chat 
        && msg.chat.type 
        && (msg.chat.type === 'group' 
        || msg.chat.type === 'supergroup'
        || msg.chat.type === 'channel'))
    {
        id = msg.chat.id;
    }
    else {
        id = msg.from.id;
    } 

    if(obj)
        return bot.sendMessage(id, text, obj);
    else 
        return bot.sendMessage(id, text);
};

const bot = getBot();

var init = function(){
    setBotCommand();
    setBotListeners();

    scrapeImg();

    restoreUsersSetting();

    setInterval(() => {
        removeFirstItem()
    },
        config.IMGS_ARR_REFRESH
    );
    setInterval(() => {
        scrapeImg()
    },config.IMGS_REFRESH_TIME);

    bot.start();
};

init();
