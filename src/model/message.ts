interface User {
    id : number;
    is_bot : boolean;
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
export interface Message {
    message_id : number;
    from? : User;
    date : number;
    chat : Chat;
}