import dotenv from 'dotenv-safe'
import {ChatGPTAPI, ChatGPTUnofficialProxyAPI, ChatMessage} from 'chatgpt'
import debounce from 'debounce-promise';

dotenv.config()
const openaiTimeout = Number(process.env.OPENAI_TIME_OUT) || 5000;
const KEY_TYPE: string = "KEY";
const TOKEN_TYPE: string = "TOKEN";
let chatType = process.env.TYPE || "TOKEN";
let proxyPool: any[] = [
    "https://gpt.pawan.krd/backend-api/conversation",
    "https://server.chatgpt.yt/api/conversation",
    "https://chat.duti.tech/api/conversation"
];
const {App} = require('@slack/bolt');

// Initializes your app with your bot token and signing secret
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    port: 3002,
    developerMode: false,
});

const keyChat = new ChatGPTAPI({
    apiKey: process.env.OPENAI_API_KEY,
    debug: false
});
const tokenChat = new ChatGPTUnofficialProxyAPI({
    accessToken: process.env.OPENAI_ACCESS_TOKEN!,
    apiReverseProxyUrl: proxyPool[0],
    debug: false
})

// Save conversation id
let conversationId: string
let parentMessageId: string

// --------------------

const updateMessage = debounce(async ({channel, ts, text, payload}: any) => {
    await app.client.chat.update({
        channel: channel,
        ts: ts,
        text: text,
        metadata: payload ? {
            event_type: "chat_gpt",
            event_payload: payload
        } : undefined
    });
}, 400);

async function sendChatAndUpdateMessage(type, event, parentMessageId, conversationId, replyMessage) {
    const chat = type === KEY_TYPE ? keyChat : tokenChat;
    console.log("the_chat_type:" + type);
    const answer = await chat.sendMessage(event.text, {
        parentMessageId: parentMessageId,
        conversationId: conversationId,
        timeoutMs: openaiTimeout,
        onProgress: async (answer) => {
            // Real-time update
            // console.log('answer:' + answer.text + "\r\n");
            await updateMessage({
                channel: replyMessage.channel,
                ts: replyMessage.ts,
                text: answer.text,
                payload: answer,
            });
        }
    });
    return Promise.resolve(answer);
}

async function sendChatOnly(type, question, parentMessageId, conversationId) {
    const chat = type === KEY_TYPE ? keyChat : tokenChat;
    console.log("the_chat_type:" + type);
    const answer = await chat.sendMessage(question, {
        parentMessageId: parentMessageId,
        conversationId: conversationId,
        timeoutMs: openaiTimeout
    });
    return Promise.resolve(answer);
}

const resortProxyPool = function () {
    // proxyPool = proxyPool.slice(1).concat(proxyPool.slice(0, 1));
    proxyPool.push(proxyPool.shift());
}

// Listens to incoming messages that contain "hello"
app.message(async ({message, say}) => {
    console.log('on_message:' + JSON.stringify(message) + "\r\n");
    console.log('===========================================================\r\n');

    const isUserMessage = message.type === "message" && !message.subtype && !message.bot_id;
    if (isUserMessage && message.text && message.text !== "reset") {
        if (message.text == "usekey") {
            chatType = KEY_TYPE;
            await say({
                channel: message.channel,
                text: '已设置KEY模式',
            });
            return;
        }
        if (message.text == "usetoken") {
            chatType = TOKEN_TYPE;
            await say({
                channel: message.channel,
                text: '已设置TOKEN模式',
            });
            return;
        }

        const {messages} = await app.client.conversations.history({
            channel: message.channel,
            latest: message.ts,
            inclusive: true,
            include_all_metadata: true,
            limit: 2
        });

        const previous = (messages || [])[1]?.metadata?.event_payload as any || {
            parentMessageId: undefined,
            conversationId: undefined
        };

        const replyMessage = await say({
            channel: message.channel,
            text: ':thought_balloon:',
        });

        try {
            const answer = await sendChatAndUpdateMessage(chatType, message, previous.parentMessageId, previous.conversationId, replyMessage);

            console.log("Response to @" + message.user + ":\n" + answer.text)

            await updateMessage({
                channel: replyMessage.channel,
                ts: replyMessage.ts,
                text: `${answer.text} :end:`,
                payload: answer,
            });
        } catch (error) {
            await say("别慌，简单说就是服务器招架不住了，你等一会再玩。【" + JSON.stringify(error) + "】");
            console.log(error);
            //交换代理
            //[proxyMain, proxySlave] = [proxySlave, proxyMain];
            //重排代理
            if (chatType == TOKEN_TYPE) {
                resortProxyPool();
                tokenChat["_apiReverseProxyUrl"] = proxyPool[0];
            }
        }
    }
});

// Listens to mention
app.event('app_mention', async ({event, context, client, say}) => {
    console.log('on_app_mention:' + JSON.stringify(event) + "\r\n");
    console.log('===========================================================\r\n');
    const question = event.text.replace(/(?:\s)<@[^, ]*|(?:^)<@[^, ]*/, '')

    try {
        // reply
        let answerText = "<@" + event.user + "> You asked:\n";
        answerText += ">" + question + "\n";
        const answer = await sendChatOnly(chatType, question, parentMessageId, conversationId);

        if (answer.conversationId) {
            conversationId = answer.conversationId;
        }

        if (answer.id) {
            parentMessageId = answer.id;
        }

        answerText += answer.text;

        await say({
            channel: event.channel,
            text: answerText,
        });
    } catch (error) {
        await say("别慌，简单说就是服务器招架不住了，你等一会再玩。【" + JSON.stringify(error) + "】");
        console.log(error);
        //交换代理
        if (chatType == TOKEN_TYPE) {
            resortProxyPool();
            tokenChat["_apiReverseProxyUrl"] = proxyPool[0];
        }
    }

});

app.message("reset", async ({message, say}) => {
    console.log('reset：' + message.channel + "\r\n");
    console.log('===========================================================\r\n');
    conversationId = ""
    parentMessageId = ""
    await say({
        channel: message.channel,
        text: 'I reset your session',
    });
});

(async () => {
    await app.start();

    console.log('⚡️ Bolt app is running at port 3002!');
})();
