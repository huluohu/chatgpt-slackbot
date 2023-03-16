import dotenv from 'dotenv-safe'
import {ChatGPTAPI, ChatGPTUnofficialProxyAPI, ChatMessage} from 'chatgpt'
import debounce from 'debounce-promise';
import {compile} from 'html-to-text';
import * as fs from 'fs'

dotenv.config({
    example: 'example.env'
});
const KEY_TYPE: string = "KEY";
const TOKEN_TYPE: string = "TOKEN";
const openaiTimeout = Number(process.env.OPENAI_TIME_OUT) || 5000;
const openaiProxy = process.env.OPENAI_HTTP_PROXY;
const chatDebug = process.env.CHAT_DEBUG == "true";
const googleApiKey = process.env.GOOGLE_API_KEY || "";
const googleSearchId = process.env.GOOGLE_SEARCH_ID || "";
let openAIEnableInternet = process.env.OPENAI_ENABLE_INTERNET == "true";
let chatType = process.env.TYPE || "TOKEN";
let reversePool: any[] = [
    // "https://server.chatgpt.yt/api/conversation",
    "https://bypass.duti.tech/api/conversation",
    "https://gpt.pawan.krd/backend-api/conversation"
];

const promptFile = fs.readFileSync('prompt.json','utf-8');
const promptJson = JSON.parse(promptFile);

//如果单独提供了反代，则加到第一个
if (process.env.OPENAI_REVERSE_EXTRA) {
    reversePool.unshift(process.env.OPENAI_REVERSE_EXTRA);
}

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
    apiKey: process.env.OPENAI_API_KEY || "",
    debug: chatDebug,
    completionParams: {
        // model: 'gpt-4',
        max_tokens: 1200,
        temperature: 0.9
    },
    fetch: openaiProxy ? (url, options = {}) => {
        const defaultOptions = {
            agent: require('https-proxy-agent')(openaiProxy)
        };

        const mergedOptions = {
            ...defaultOptions,
            ...options
        };

        return require('node-fetch').default(url, mergedOptions);
    } : fetch
})

// const keyChat = new ChatGPTAPI({
//     apiKey: process.env.OPENAI_API_KEY,
//     debug: chatDebug
// });
const tokenChat = new ChatGPTUnofficialProxyAPI({
    accessToken: process.env.OPENAI_ACCESS_TOKEN || "",
    apiReverseProxyUrl: reversePool[0],
    debug: chatDebug
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

async function sendChatOnAppProgress(type, prompt, parentMessageId, conversationId, reply) {
    const chat = type === KEY_TYPE ? keyChat : tokenChat;
    console.log("the_chat_type:" + type);
    const answer = await chat.sendMessage(prompt, {
        parentMessageId: parentMessageId,
        conversationId: conversationId,
        timeoutMs: openaiTimeout,
        // systemMessage: "你是一名人工智能开发人员，你熟悉关于构建人工智能系统的各种知识和技能",
        onProgress: async (answer) => {
            // Real-time update
            // console.log('answer:' + answer.text + "\r\n");
            await updateMessage({
                channel: reply.channel,
                ts: reply.ts,
                text: answer.text,
                payload: answer,
            });
        }
    });
    return Promise.resolve(answer);
}

async function sendChatOnChannleProgress(type, event, question, parentMessageId, conversationId, reply) {
    const chat = type === KEY_TYPE ? keyChat : tokenChat;
    console.log("the_chat_type:" + type);
    const answer = await chat.sendMessage(question, {
        parentMessageId: parentMessageId,
        conversationId: conversationId,
        timeoutMs: openaiTimeout,
        onProgress: async (answer) => {
            // Real-time update
            // console.log('answer:' + answer.text + "\r\n");
            await updateMessage({
                channel: reply.channel,
                ts: reply.ts,
                text: `<@${event.user}> You asked:\n>${question}\n${answer.text}`,
                payload: answer,
            });
        }
    });

    conversationId = answer.conversationId || conversationId;
    parentMessageId = answer.id || parentMessageId;
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

async function getGoogleSearchFirstResultText(searchTerm) {
    try {
        const response = await fetch(
            `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${googleSearchId}&q=${searchTerm}`
        );

        const data = await response.json();
        const [firstpage, ...remainingPages] = data.items;
        const urlToCheck = firstpage.link;
        const htmlString = await fetch(urlToCheck);
        let context = html2Text(await htmlString.text());
        context += remainingPages
            .reduce((allPages, currentPage) => `${allPages} ${currentPage.snippet}`, "")
            .replaceAll("...", " "); // Remove "..." from Google snippet results;

        // Note: we must stay below the max token amount of OpenAI's API.
        // Max token amount: 4096, 1 token ~= 4 chars in English
        // Hence, we should roughly ensure we stay below 10,000 characters for the input
        // and leave the remaining the tokens for the answer.
        // - https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
        // - https://platform.openai.com/docs/api-reference/chat/create
        context = context
            .replaceAll("\n", " ") // Remove any new lines from raw HTML of first page
            .trim()
            .substring(0, 10000);

        return context;
    } catch (error) {
        console.error(error);
        return undefined;
    }
}

const resortProxyPool = function () {
    // proxyPool = proxyPool.slice(1).concat(proxyPool.slice(0, 1));
    reversePool.push(reversePool.shift());
}

const html2Text = compile({
    preserveNewlines: false,
    wordwrap: false,
    // The main content of a website will typically be found in the main element
    baseElements: {selectors: ["main"]},
    selectors: [
        {
            selector: "a",
            options: {ignoreHref: true},
        },
    ],
});

// Listens to incoming messages that contain "hello"
app.message(async ({message, say}) => {
    console.log(`on_message: ${JSON.stringify(message)}\r\n`);
    console.log('===========================================================\r\n');
    console.log('openAIEnableInternet1:' + openAIEnableInternet);
    console.log('chatDebug:' + chatDebug);
    //非正常消息
    if (message.type !== "message" || message.subtype || message.bot_id || !message.text || message.text === "reset") {
        return;
    }

    async function setChatType(type, channel) {
        chatType = type;
        await say({
            channel,
            text: `已设置${type === KEY_TYPE ? "KEY" : "TOKEN【不建议使用，账号有被ban风险】"}模式`,
        });
    }

    async function SetEnableInternet(enable, channel) {
        openAIEnableInternet = enable;
        await say({
            channel,
            text: `已${openAIEnableInternet ? "开启联网" : "关闭联网"}能力`,
        });
    }

    // 设置聊天模式
    if (message.text === "usekey" || message.text === "usetoken") {
        await setChatType(message.text === "usekey" ? KEY_TYPE : TOKEN_TYPE, message.channel);
        return;
    }

    // 设置聊天模式
    if (message.text === "ointernet" || message.text === "cinternet") {
        await SetEnableInternet(message.text === "ointernet" ? true : false, message.channel);
        return;
    }

    let prompt = message.text;
    //从搜索引擎中搜索
    console.log('openAIEnableInternet2:' + openAIEnableInternet);
    if (openAIEnableInternet) {
        const searchText = await getGoogleSearchFirstResultText(prompt);
        console.log(`searchText: ${searchText} `);
        if (searchText) {
            prompt = `With the information in the assistant's last message, answer this: ${searchText}`;
        }
    }

    //获取上一条消息
    const {messages} = await app.client.conversations.history({
        channel: message.channel,
        latest: message.ts,
        inclusive: true,
        include_all_metadata: true,
        limit: 2
    });

    const previous = messages?.[1]?.metadata?.event_payload ?? {
        parentMessageId: undefined,
        conversationId: undefined
    };

    // 发送回复消息
    const reply = await say({
        channel: message.channel,
        text: ':thought_balloon:',
    });


    try {
        // 发送聊天消息并更新回复消息
        const answer = await sendChatOnAppProgress(chatType, prompt, previous.parentMessageId, previous.conversationId, reply);
        console.log(`Response to @${message.user}:\n${answer.text}`);
        await updateMessage({
            channel: reply.channel,
            ts: reply.ts,
            text: `${answer.text} :end:`,
            payload: answer,
        });
    } catch (error) {
        console.log(error);

        if (chatType == TOKEN_TYPE) {
            resortProxyPool();
            tokenChat["_apiReverseProxyUrl"] = reversePool[0];
        }

        const friendlyErrorMsg = '别慌，简单说就是服务器招架不住了，你等一会再玩。';
        await say(friendlyErrorMsg);
    }
});

app.message("reset", async ({message, say}) => {
    const {channel} = message;
    console.log('reset：${channel} \r\n');
    console.log('===========================================================\r\n');
    resetSession();
    await say({
        channel: message.channel,
        text: 'I reset your session',
    });
});


// Listens to mention
app.event('app_mention', async ({event, context, client, say}) => {
    console.log(`on_mention: ${JSON.stringify(event)}\r\n`);
    console.log('===========================================================\r\n');
    const question = event.text.replace(/(?:\s)<@[^, ]*|(?:^)<@[^, ]*/, '')

    try {
        const reply = await say({
            channel: event.channel,
            text: ':thought_balloon:',
        });

        const answer = await sendChatOnChannleProgress(chatType, event, question, parentMessageId, conversationId, reply);
        await updateMessage({
            channel: reply.channel,
            ts: reply.ts,
            text: `<@${event.user}> You asked:\n>${question}\n${answer.text} :end:`,
            payload: answer,
        });
    } catch (error) {
        console.log(error);

        if (chatType == TOKEN_TYPE) {
            resortProxyPool();
            tokenChat["_apiReverseProxyUrl"] = reversePool[0];
        }

        const friendlyErrorMsg = '别慌，简单说就是服务器招架不住了，你等一会再玩。';
        await say(friendlyErrorMsg);
    }

});

// 监听 `/hello` 命令
app.command('/neko', async ({ command, ack, say }) => {
   console.log('command:' + command);
  // 确认收到了命令
   await ack();
   resetSession();

  // 回复用户
   await say(`喵，主人~`);
});

function resetSession() {
    conversationId = ""
    parentMessageId = ""
}

(async () => {
    await app.start();

    console.log('⚡️ Bolt app is running at port 3002!');
})();
