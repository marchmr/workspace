declare module 'nodemailer' {
    const nodemailer: {
        createTransport: (options: any) => {
            sendMail: (mail: any) => Promise<any>;
        };
    };
    export default nodemailer;
}
