import { Config } from "./Config";

export class FlickrConfig {
    public static FLICKR_KEY: string = '';
    public static ENDPOINT: string = 'https://api.flickr.com/services/rest/';
    public static METHODS : Array<string> = ['flickr.interestingness.getList',
        'flickr.people.getInfo',
        'flickr.photos.getInfo',
        'flickr.photos.search'
    ];
    public static API_KEY: string = Config.FLICKR_KEY;
    public static EXTRAS: Array<string> = ['path_alias',
        '',
        '',
        'can_comment,count_comments,count_faves,description,isfavorite,license,media,needs_interstitial,owner_name,path_alias,realname,rotation,url_c,url_l,url_m,url_n,url_q,url_s,url_sq,url_t,url_z'
    ];                                  
    public static PER_PAGE: Array<number> = [1, -1, -1, 25]; /* Flickr max default: 500 */
    public static PAGE: Array<number> = [-1, -1, -1, 1];
    public static SORT: Array<string> = ['', '', '', 'relevance'];
    public static PARSE_TAG: Array<string> = ['', '', '', '1'];
    public static CONTENT_TYPE: Array<string>  = ['', '', '', '1'];
    public static FORMAT: string = 'json';
    public static NOJSONCB: number = 1;
    public static FLICKR_EXPLORE_URL: string =  'https://www.flickr.com/explore/';
}