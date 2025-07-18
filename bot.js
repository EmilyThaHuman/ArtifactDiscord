const { Client, GatewayIntentBits } = require('discord.js');
const { OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    defaultHeaders: {
        'OpenAI-Beta': 'assistants=v2'
    }
});

// Discord Client
const client = new Client({
  intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// When discord bot has started up
client.once('ready', () => {
    console.log('Bot is ready!');
});


const threadMap = {};

const getOpenAiThreadId = (discordThreadId) => {
    // Replace this in-memory implementation with a database (e.g. DynamoDB, Firestore, Redis)
    return threadMap[discordThreadId];
}

const addThreadToMap = (discordThreadId, openAiThreadId) => {
    threadMap[discordThreadId] = openAiThreadId;
}

const terminalStates = ["cancelled", "failed", "completed", "expired"];
const statusCheckLoop = async (openAiThreadId, runId) => {
    const run = await openai.beta.threads.runs.retrieve(
        openAiThreadId,
        runId
    );

    if(terminalStates.indexOf(run.status) < 0){
        await sleep(1000);
        return statusCheckLoop(openAiThreadId, runId);
    }
    // console.log(run);

    return run.status;
}

const addMessage = (threadId, content) => {
    // console.log(content);
    return openai.beta.threads.messages.create(
        threadId,
        { role: "user", content }
    )
}

// This event will run every time a message is received
client.on('messageCreate', async message => {
    try {
        if (message.author.bot || !message.content || message.content === '') return; //Ignore bot messages
        
        // Debug logging
        console.log('Message received:', message.content);
        console.log('Bot mentioned:', message.mentions.has(client.user));
        console.log('Mentions:', message.mentions.users.map(user => user.username));
    
    // Only respond if the bot is mentioned in the message
    if (!message.mentions.has(client.user)) {
        console.log('Bot not mentioned, ignoring message');
        return;
    }
    
    // Double check - ensure the bot is actually mentioned
    const botMentioned = message.mentions.users.has(client.user.id);
    if (!botMentioned) {
        console.log('Bot not in mentions list, ignoring message');
        return;
    }
    
    console.log('Bot mentioned, processing message');
    
    // Remove bot mention from message content before processing
    const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!cleanContent) return; // Don't respond to empty messages after removing mentions
    
    // console.log(message);
    const discordThreadId = message.channel.id;
    let openAiThreadId = getOpenAiThreadId(discordThreadId);

    let messagesLoaded = false;
    if(!openAiThreadId){
        const thread = await openai.beta.threads.create();
        openAiThreadId = thread.id;
        addThreadToMap(discordThreadId, openAiThreadId);
        if(message.channel.isThread()){
            //Gather all thread messages to fill out the OpenAI thread since we haven't seen this one yet
            const starterMsg = await message.channel.fetchStarterMessage();
            const otherMessagesRaw = await message.channel.messages.fetch();

            const otherMessages = Array.from(otherMessagesRaw.values())
                .map(msg => msg.content.replace(/<@!?\d+>/g, '').trim())
                .reverse(); //oldest first

            const messages = [starterMsg.content.replace(/<@!?\d+>/g, '').trim(), ...otherMessages]
                .filter(msg => !!msg && msg !== '')

            // console.log(messages);
            await Promise.all(messages.map(msg => addMessage(openAiThreadId, msg)));
            messagesLoaded = true;
        }
    }

    // console.log(openAiThreadId);
    if(!messagesLoaded){ //If this is for a thread, assume msg was loaded via .fetch() earlier
        await addMessage(openAiThreadId, cleanContent);
    }

    const run = await openai.beta.threads.runs.create(
        openAiThreadId,
        { assistant_id: process.env.ASSISTANT_ID }
    )
    const status = await statusCheckLoop(openAiThreadId, run.id);

    const messages = await openai.beta.threads.messages.list(openAiThreadId);
    let response = messages.data[0].content[0].text.value;
    response = response.substring(0, 1999) //Discord msg length limit when I was testing

    console.log(response);
    
    message.reply(response);
    } catch (error) {
        console.error('Error processing message:', error);
        message.reply('Sorry, I encountered an error processing your message.');
    }
});

// Authenticate Discord
client.login(process.env.DISCORD_TOKEN);