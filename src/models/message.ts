interface User {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
}
interface Chat {
    id: number;
    type: string;
    title?: string;
}
interface ILocation {
    latitude: number;
    longitude: number;
}
export interface Message {
    id: string;
    from?: User;
    date: number;
    chat: Chat;
    message?: any;
    query?: string;
    location?: ILocation;
}