import { Config } from "./Config";

export class FlickrConfig {
    public static FLICKR_KEY: string = '';
    public static ENDPOINT: 'https://api.flickr.com/services/rest/';
    public static METHODS: ['flickr.interestingness.getList',
        'flickr.people.getInfo',
        'flickr.photos.getInfo',
        'flickr.photos.search'
    ];
    public static API_KEY: string = Config.FLICKR_KEY;
    public static EXTRAS: ['path_alias',
        '',
        '',
        'can_comment,count_comments,count_faves,description,isfavorite,license,media,needs_interstitial,owner_name,path_alias,realname,rotation,url_c,url_l,url_m,url_n,url_q,url_s,url_sq,url_t,url_z'
    ];                                  
    public static PER_PAGE: [1, -1, -1, 25]; /* Flickr max default: 500 */
    public static PAGE: [-1, -1, -1, 1];
    public static SORT: ['', '', '', 'relevance'];
    public static PARSE_TAG: ['', '', '', '1'];
    public static CONTENT_TYPE: ['', '', '', '1'];
    public static FORMAT: 'json';
    public static NOJSONCB: 1;
    public static FLICKR_EXPLORE_URL: string =  'https://www.flickr.com/explore/';
}