const TeleBot = require('telebot');
const config = require('./config.js').config;
const rp = require('request-promise');
const async = require('async');

const bot = new TeleBot({
    token: config.BOT_TOKEN
});

const flickrObj = {
    ENDPOINT    : 'https://api.flickr.com/services/rest/',
    METHODS     : ['flickr.interestingness.getList', 'flickr.people.getInfo'],
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

bot.on(['/start'], (msg) =>  msg.reply.text(getWelcome(msg.from.first_name)));
bot.on(['/photo'], (msg) => getPhoto(msg) );
bot.on('/help', (msg) => msg.reply.text(usage()));
bot.on('/about', (msg) => msg.reply.text(about()));
bot.start();