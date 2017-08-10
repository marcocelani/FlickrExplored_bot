var config = {
    BOT_TOKEN           : 'YOUR_TOKEN',
    FLICKR_KEY          : 'YOUR_FLICKR_KEY',
    TELEGRAM_USERNAME   : 'YOUR_USERNAME',
    APP_NAME            : 'APP_NAME',
    IMGS_REFRESH_TIME   : (1000 * 60 * 60 * 24), /* 24h */
    IMGS_ARR_REFRESH    : (1000 * 60 * 60 * 23), /* 23h */
    DAY_BEFORE          : 28, /* FULL MOON =) */
    TASK_DELAY          : 60, /* minutes */
    ENABLE_WEBHOOK      : true,
    POLLING             : {
        interval    : 5000
    },
    WEBHOOK             : {
        url : 'URL',
        key : 'file.key',
        cert: 'file.cert',
        port: 'PORT_NUMBER',
        host: '0.0.0.0'
    },
    ENABLE_MONGODB      : false,
    MONGODB             : {
        connectionStr : 'mongodb://localhost:27017/yourproject',
        usersCollection : 'your_collection'
    }
}

exports.config = config;