import dotenv from 'dotenv-safe'
import {ChatGPTUnofficialProxyAPI} from 'chatgpt'
import debounce from 'debounce-promise';

dotenv.config()
const openaiTimeout = process.env.OPENAI_TIME_OUT;

const {App} = require('@slack/bolt');

// Initializes your app with your bot token and signing secret
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    port : 3002
});

// const chatAPI = new ChatGPTAPI({ apiKey: process.env.OPENAI_API_KEY });
const chat = new ChatGPTUnofficialProxyAPI({
    accessToken: process.env.OPENAI_ACCESS_TOKEN!,
    // apiReverseProxyUrl: process.env.API_REVERSE_PROXY_URL,
    apiReverseProxyUrl: 'https://gpt.pawan.krd/backend-api/conversation',
    debug: true
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

// Listens to incoming messages that contain "hello"
app.message(async ({message, say}) => {
    console.log('on_message:' + JSON.stringify(message) + "\r\n");
    console.log('===========================================================\r\n');

    const isUserMessage = message.type === "message" && !message.subtype && !message.bot_id;
    if (isUserMessage && message.text && message.text !== "reset") {
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

        const ms = await say({
            channel: message.channel,
            text: ':thought_balloon:',
        });


        let answerText: string;
        try {
            const answer = await chat.sendMessage(message.text, {
                parentMessageId: previous.parentMessageId,
                conversationId: previous.conversationId,
                timeoutMs : Number(openaiTimeout),
                onProgress: async (answer) => {
                    // Real-time update
                    answerText = answer.text;
                    await updateMessage({
                        channel: ms.channel,
                        ts: ms.ts,
                        text: answerText,
                        payload: answer,
                    });
                }
            });

            console.log("Response to @" + message.user + ":\n" + answerText)

            await updateMessage({
                channel: ms.channel,
                ts: ms.ts,
                text: `${answerText} :end:`,
                payload: answer,
            });
        } catch (error) {
            await say("ERROR: Something went wrong, please try again after a while：" + JSON.stringify(error));
            console.log(error);
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


// Listens to mention
app.event('app_mention', async ({event, context, client, say}) => {
    console.log('on_app_mention:' + JSON.stringify(event) + "\r\n");
    console.log('===========================================================\r\n');
    const question = event.text.replace(/(?:\s)<@[^, ]*|(?:^)<@[^, ]*/, '')

    try {
        // reply
        let answerText = "<@" + event.user + "> You asked:\n";
        answerText += ">" + question + "\n";
        const answer = await chat.sendMessage(question, {
            parentMessageId: parentMessageId,
            conversationId: conversationId,
            timeoutMs : Number(openaiTimeout)
        });

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
        await say("ERROR: Something went wrong, please try again after a while：" + JSON.stringify(error));
        console.log(error)
    }

});

(async () => {
    await app.start();

    console.log('⚡️ Bolt app is running at port 4000!');
})();
