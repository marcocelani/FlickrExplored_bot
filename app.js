const TeleBot = require('telebot');
const config = require('./config.js').config;
const rp = require('request-promise');
const async = require('async');
const htmlparser = require('htmlparser2');

const bot = new TeleBot({
    token: config.BOT_TOKEN
});

const flickrObj = {
    ENDPOINT    : 'https://api.flickr.com/services/rest/',
    METHODS     : ['flickr.interestingness.getList', 'flickr.people.getInfo', 'flickr.photos.getInfo'],
    API_KEY     : config.FLICKR_KEY,
    EXTRAS      : 'path_alias,',
    PER_PAGE    : 1, /* Flickr max default: 500 */
    FORMAT      : 'json',
    NOJSONCB    : 1,
};

var about = function(){
    return `${config.APP_NAME} made by @${config.TELEGRAM_USERNAME}.`;
};

var usage = function() {
    return `Type /photo for pick a photo.
Type /help for show help.
Type /about for show info.`; 
};

var getWelcome = function(firstName) {
   return `Welcome ${(firstName) ? firstName : 'user'}!
My mission is to show you the most Flickr's interesting photos in a randomic way.
${usage()}`;
};

/* get randomic number between 0 and max. */
var getRandomic = function(upperBound){
    if(upperBound && typeof(upperBound) !== 'number')
        return 0;
    let min = 0;
    let max = Math.floor(upperBound);
    return Math.floor(Math.random() * (max - min)) + min;
};

var getMsgError = function(response){
    if(response){
        return `Something goes wrong. Flickr response:${response.message}, code:${response.code}`;
    }
    return '';
};

var getPhoto = function(msg){
    if(!msg){
        console.log(`Strange error, msg is empty. Nothing to do.`);
        return;
    }
    
    async.waterfall(
        [
            cb => {
                let rpOpt = {
                    uri: `${flickrObj.ENDPOINT}`,
                    qs : {
                        method: flickrObj.METHODS[0],
                        api_key: flickrObj.API_KEY,
                        //extras: flickrObj.EXTRAS,
                        per_page: flickrObj.PER_PAGE,
                        page: getRandomic(499),
                        format: flickrObj.FORMAT,
                        nojsoncallback: flickrObj.NOJSONCB
                    },
                    json: true
                };

                rp(rpOpt)
                .then( response => {
                    if(response.stat === 'fail'){
                        cb(new Error(getMsgError(response)));
                        return;
                    }
                    if(response.photos.photo.length == 0){
                        cb(new Error('Sorry, no photos were found.'));
                        return;
                    }
                    cb(null, response.photos.photo[0])   
                })
                .catch( err => {
                    console.log('err:', err);
                    cb(err);
                });
            },
            (photoObj, cb) => {
                let rpOpt = {
                    uri: flickrObj.ENDPOINT,
                    qs: {
                        method: flickrObj.METHODS[1],
                        api_key: flickrObj.API_KEY,
                        user_id: photoObj.owner,
                        format: flickrObj.FORMAT,
                        nojsoncallback: flickrObj.NOJSONCB
                    },
                    json: true
                }

                rp(rpOpt)
                .then( result => {
                    if(result.stat === 'fail'){
                        cb(getMsgError(result));
                    } else {
                        cb(null, {photoId: photoObj.id, photosUrl: result.person.photosurl._content});
                    }
                })
                .catch( err => {
                    console.log(err);
                    cb(err);
                });
            }
        ],
        (err, result) => {
            if(err){
                msg.reply.text(err.message);
            }
            else {
                msg.reply.text(`${result.photosUrl}${result.photoId}`);
            }
        }
    )};

var getPhotoV2 = function(msg){
    let imgs = [];
    let parser = new htmlparser.Parser(
        {
            onopentag: (name, attribs) => {
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
                                    console.log('img has no length.');
                                    return;
                                }
                                img = img[img.length-1];
                                let img_id = img.split('_');
                                if(img_id.length == 0){
                                    console.log('img_id has no length.');
                                    return;
                                }
                                imgs.push(img_id[0]);
                            }
                        }
                    }
                }
            }
        }
    );

    async.waterfall([
        cb => {
            rp('https://www.flickr.com/explore')
            .then( html => {
                parser.write(html);
                parser.end();
                if(imgs.length > 0 ){
                    let picked_id = imgs[getRandomic(imgs.length-1)];
                    cb(null, picked_id);
                } else {
                    msg.reply.text('Sorry, no images found.');
                    cb(new Error());
                }
            })
            .catch( err => {
                console.log(err);
                cb(err);
            });
        },
        (img_id, cb) => {
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
                if(response.photo
                    && response.photo.urls
                    && response.photo.urls.url 
                    && response.photo.urls.url[0]
                    && response.photo.urls.url[0]._content)
                    cb(null, response.photo.urls.url[0]._content);
                else {
                    cb(new Error('Sorry, wrong object.'));
                }
            })
            .catch( err => {
                console.log(err);
                cb(err);
            });   
        }
    ], (err, result) => {
        if(err){
            console.log(err.message);
            msg.reply.text(`Something goes wrong.`);
        }
         else {
             msg.reply.text(result);
         }
    });
};

bot.on(['/start'], (msg) =>  msg.reply.text(getWelcome(msg.from.first_name)));
bot.on(['/photo'], (msg) => getPhotoV2(msg) );
bot.on('/help', (msg) => msg.reply.text(usage()));
bot.on('/about', (msg) => msg.reply.text(about()));
bot.start();