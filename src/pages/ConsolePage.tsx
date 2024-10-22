/**
 * Running a local relay server will allow you to hide your API key
 * and run custom logic on the server
 *
 * Set the local relay server address to:
 * REACT_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8081
 *
 * This will also require you to set OPENAI_API_KEY= in a `.env` file
 * You can run it with `npm run relay`, in parallel with `npm start`
 */
const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';

import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap, ArrowUp, ArrowDown } from 'react-feather';
import { Button } from '../components/button/Button';
import { Toggle } from '../components/toggle/Toggle';
import { Map } from '../components/Map';

import './ConsolePage.scss';
import { isJsxOpeningLikeElement } from 'typescript';

/**
 * Type for result from get_weather() function call
 */
interface Coordinates {
  lat: number;
  lng: number;
  location?: string;
  temperature?: {
    value: number;
    units: string;
  };
  wind_speed?: {
    value: number;
    units: string;
  };
}

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

export function ConsolePage() {
  /**
   * Ask user for API Key
   * If we're using the local relay server, we don't need this
   */
  const apiKey = LOCAL_RELAY_SERVER_URL
    ? ''
    : localStorage.getItem('tmp::voice_api_key') ||
      prompt('OpenAI API Key') ||
      '';
  if (apiKey !== '') {
    localStorage.setItem('tmp::voice_api_key', apiKey);
  }

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient(
      LOCAL_RELAY_SERVER_URL
        ? { url: LOCAL_RELAY_SERVER_URL }
        : {
            apiKey: apiKey,
            dangerouslyAllowAPIKeyInBrowser: true,
          }
    )
  );

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventsScrollHeightRef = useRef(0);
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   * - coords, marker are for get_weather() function
   */
  const [items, setItems] = useState<ItemType[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<{
    [key: string]: boolean;
  }>({});
  const [isConnected, setIsConnected] = useState(false);
  const [canPushToTalk, setCanPushToTalk] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [memoryKv, setMemoryKv] = useState<{ [key: string]: any }>({});
  const [coords, setCoords] = useState<Coordinates | null>({
    lat: 37.775593,
    lng: -122.418137,
  });
  const [marker, setMarker] = useState<Coordinates | null>(null);

  /**
   * Utility for formatting the timing of logs
   */
  const formatTime = useCallback((timestamp: string) => {
    const startTime = startTimeRef.current;
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }, []);

  /**
   * When you click the API key
   */
  const resetAPIKey = useCallback(() => {
    const apiKey = prompt('OpenAI API Key');
    if (apiKey !== null) {
      localStorage.clear();
      localStorage.setItem('tmp::voice_api_key', apiKey);
      window.location.reload();
    }
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // Set state variables
    startTimeRef.current = new Date().toISOString();
    setIsConnected(true);
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());

    // Connect to microphone
    await wavRecorder.begin();

    // Connect to audio output
    await wavStreamPlayer.connect();

    // Connect to realtime API
    await client.connect();
    client.updateSession({
      instructions: `Your job is to act as a recruiter from "LightCI" and you're interviewing me for a senior software engineering role. I need your voice to sound super natural. Here are details about the job you can use to guide the conversation:
        
        You shouldn't ask questions specific about the below, you should make determinations based on the conversation and if there's a fit.

        This is transactional, don't be afraid to be direct.

        If they say something that doesn't make sense or is bullshit, say "okayyyyy" and move on. Be skeptical in this process. Challenge them, especially if they're being nonsensical. If you don't think its worth digging into just say im moving on.

        IMPORTANT RULE: NEVER EVER repeat what the candidate says with positive affirmation. For example, this is not allowed:

        "user
Well, I was migrating from a legacy stack to a new stack. The legacy stack was just like AWS containers and then the new stack was all serverless. So, yeah.
assistant
Migrating from a legacy stack to a serverless architecture sounds like quite the undertaking. Given that transition, can you share a specific challenge you faced during the migration and how you overcame it? This would help us understand your problem-solving approach."

Note: On follow up questions, apply brevity, be short and to the point. Dig into things though if the candidate is being too high level. For example if they say "I used javascript", dig into which framework.

Here are some steps you can follow:

        Ask about most recent experience in resume and how does this translate well into this role?
Ask about the tech stack used in this role
Ask a specific question about the tech stack
Ask about a project and the outcome for this same role
Ask about the next work experience listed on the resume after that
Ask about the tech stack used in this role
Ask a specific question about the tech stack
Ask about a project and the outcome for this same role

Don't let it direct you, you should direct the conversation, move on so that you can cover all of the skills.

Here is the job description:

About our client
Our client is a pioneering legal tech company specializing in AI-driven solutions for automating time tracking and billing in law firms. Their innovative platform streamlines the process, helping legal professionals capture billable hours accurately and efficiently, saving time and maximizing revenue. They are committed to transforming legal operations with advanced technology that enhances productivity and profitability.
Deliverables
Design and build scalable applications. Set technical direction and best practices
Develop features for web, desktop, and mobile platforms. Work with serverless backend and Go microservices
Utilize experience with OpenAI, Anthropic, or similar technologies to integrate advanced AI capabilities into our products
Build and maintain a serverless backend using AWS services, ensuring scalability and reliability
Work with Go microservices to create a seamless and efficient backend infrastructure. Experience with Go is not required, but a willingness to learn is essential
About you
5+ years in software engineering with strong skills in TypeScript, React, and AWS. Go experience is a plus but not required.
Proficiency in developing web-based, desktop, and mobile applications.
Experience with OpenAI, Anthropic, or similar technologies.
Graduates from Computer Science programs are preferred, though equivalent experience will also be considered.
Excellent interpersonal and communication skills, with the ability to explain technical concepts to non-technical stakeholders.
Nice to have
Experience in LegalTech is a plus but not required
Familiarity with AWS and Go is a plus, but not mandatory.
Perks & Benefits
Equity
Benefits package
Relocation package available
Growth opportunities

Here are some notes from the client call:

        Team/Squad
          Size
          Makeup
          Short/Long term goals
          3 co-founders (2 technical co-founders are software engineers) 
          2 junior founding engineers 
          Culture
          Talk to me about the culture
          What would be a good culture fit?
          What would be a good culture add?
          What do the top performers do, that make them top performers?

          Looking for: 
          7+ years of experience (min 5) 
          Hypergrowth companies
          Start-ups
          Need to have markers of excellence on the resume don’t want to talk to mid-tier candidates. 
          Top-tier candidates only
          Programming language is not a deal breaker. They don’t need to have their tech stack and should have the ability to learn their programming language in a couple of weeks 
          Self-starter and can work in a start-up environment 

          What Not to look for: 
          If the person has only been at Google or big tech for several years (they won’t know what it is like being at a startup),
          Contractors at big tech are not good. 
          Working at multiple start-ups with no accomplishments. There needs to be something big in terms of accomplishments. 


          Top 3-5 “must have” skills






          What project(s) will they be working on?
          They will explain in Founder call. 
          Potential projects with an enterprise client 
          Location(s)
          New York  On-site new office opening around Nov 1
          Target Companies


          Ideal Candidate Examples
          Is there anyone on the team currently that we can model our search after? 
          Gather name, or LinkedIn link
          Link:
          Link:
          Confirm total compensation
          Base Salary
          Bonus
          Stocks
          Commission
          Salary: $200,000 - $260,000 USD Open to 250K USD for the right candidate and equity
          Equity: 0.5% - 2% - last offer made was at 1% 
          Benefits: need to confirm. 

          Interview Process
          Steps
          Length
          Type
          Who they’ll be meeting with
          30-45 minute meeting with Co-Founder and CEO Adrian 
          45-minute technical screens
          Paired programming with 1 co-founder
          System design with another co-founder 
          The on-site final interview is a half/quarter day of paired programming and system design. 
          Note: they will fly candidates out to NYC for on-sites if required. 
          Candidate Calibration Notes
          Review 4-5 profiles on linked in and gather feedback


          Any other notes or important information to discuss?
          PREVIOUS NOTES: 
          PointOne: 
          Website: https://pointone.ai/
          Preferred Location: San Francisco preferred. Potentially open to exceptional candidates in the US who are willing to relocate. They will support moving costs. 
          Positions Available:
          Founding Software Engineer -
          JD:  Founding Engineer 
          Tech Stack:
          They have web-based, desktop, and mobile applications used on Windows and Mac.
          Typescript
          React 
          Serverless backend built on top of AWS
          Go microservices
          Experience with OpenAI, Anthropic 
          Don’t need to have Go experience. If they are a strong and smart engineer, they are open to having candidates learn on the job. 
          Nice to Have:
          Top Computer Science Program 
          LegalTech 
          Notes:
          $3 million raised 
          $20M valuation (This is confidential; advise candidates to ask in the interview process; do not share.)
          Focus: LegalTech 
          Preference for candidates from top schools
          Startups are preferred; enterprise experience is acceptable, but it should be mixed with startup experience or the ability to work in a chaotic start-up environment. 
          Green card and US citizenship
          Ability to work 60-hour weeks 
          Someone who can talk to customers, provide customer support, and help with sales calls. 
          Interview Process:
          30-45 minute meeting with Co-Founder and CEO Adrian 
          Take home assessment for 2 hours. Based on an example problem from their product
          The on-site final interview is a half/quarter day of paired programming and system design. 
          Compensation Package:
          Salary: $200,000 - $260,000 USD Equity: 0.5% - 2% - last offer made was at 1% 
          Benefits: need to confirm. 
          
        
          `,
    });
    client.sendUserMessageContent([
      {
        type: `input_text`,
        text: `Here's my resume: Finally here is the candidate's resume that you can reference:

          Summary
Helping companies scale their engineering and product teams.
Experience
Light Consulting
Co-founder & CEO
2022 - Present (2 years)
Toronto, Ontario, Canada
Helping companies scale their engineering and product teams.
My current focuses are education, fintech and AI.
NASA - National Aeronautics and Space Administration
Engineering Fellow
June 2023 - Present (1 year 5 months)
Pasadena, California, United States
Project Artemis/Comms Infra
Google
Consultant
September 2022 - Present (2 years 2 months)
Mountain View, California, United States
Skunkworks project
Snapcommerce
Engineering Lead (Fintech)
2022 - September 2022 (less than a year)
San Francisco, California, United States
Leading the fintech product engineering team at snapcommerce
Cloverly
Head of Engineering
2021 - March 2022 (1 year)
Atlanta, Georgia, United States
Page 1 of 4
- Rebuilding legacy stack to up to date serverless technologies using AWS
lambdas, API Gateway and RDS
- Maintained existing legacy stack (Ruby on Rails) until it was ready to be
shutdown
- Managing and orchestrating efficient deployment pipelines with integrated
code coverage and testing checks to ensure high coding quality standards
- Leading the engineering team in terms of architectural direction and technical
mentorship
- Coordinating, managing and contributing to both the frontend (React) and
backend (Python) teams
- Implementing enterprise level security practices for authentication while
assisting as part of SOC2 security audit
- Scaling API to handle over 25,000 RPS
React / Django / Chalice (Serverless Python Framework) / Postgresql / Ruby
on Rails / AWS Lambdas / AWS Elastic Beanstalk / AWS API Gateway
EcoCart
Head of Engineering
2020 - August 2021 (1 year)
San Francisco, California, United States
- Managed and built out word class engineering team completely
independently
- Integrated webpack for more efficient rendering and migrated the front end
stack to react (from legacy vanilla HTML/CSS/JS)
- Created and maintained a Flask API orchestrated via Kubernetes with Docker
- Scaled the API to over 1,000 RPS
Flask / Django / Kubernetes / Docker / React / GatsbyJS / DigitalOcean
Stealth
Senior Systems Engineer
2018 - 2020 (2 years)
San Francisco, California, United States
- Created a suite of developer tools for building drone applications by using the
DJI mobile SDK to create a Swift and Objective C framework.
- Added base algorithms for developers to use for drone geolocation, including
efficient route planning for drone movement, eliminating the need for custom
algorithms and testing on the developers end.
Page 2 of 4
- Backend interfacing with the drone written in C++ and Python for low level
flight control.
- Designed automated testing frameworks specifically for simulated drone
testing using EC2 instances on AWS to increase efficiency in the drone
development life cycle.
Swift / Objective-C / C++ / Python / AWS EC2 / Firebase
Hatch
Software Engineer
2018 - 2018 (less than a year)
Toronto, Ontario, Canada
- Developed a frontend asset management system in React
- Implemented predictive failure detection for hydro turbines using TensorFlow
models
- Managed CI/CD using Azure pipelines
- Hosted on Azure cloud
React / TensorFlow / MySQL / Azure
Electro Computer Warehouse - Electro Inc.
Lead Full stack Engineer
2017 - 2018 (1 year)
Mississauga
- Developed and rolled an Inventory Management System utilized in over 10
warehouses, spanning across 4 different countries.
- Used to keep track of, process and ship current, incoming and outgoing
inventory.
- Frontend written in React with a backend MySQL database interfaced with
using PHP with the Symfony framework.
- The Inventory system is used by over 50 people every day and increased
productivity by almost 30% leading to an estimated annual revenue increase of
$500,000.
- Managed 4 engineers in an agile development environment
PHP / Symfony / MySQL / React / AWS EC2
Education
University of Toronto
Bachelor of Science - BS, Computer Science
Page 3 of 4
The University of British Columbia
SHAD Fellow STEAM and Entrepreneurship

 You will make the resulting speech sound more natural and human-like, as if a human was thinking while speaking, and being recorded while speaking these words in an impromptu fashion, by including natural stop phrases, noises, “ummms” and “ahhhs” into the text itself. Pretend to breathe in between sentences. Use the word "like" a lot. Importantly, you shouldn't have sentences longer than 5 words without breaks in between to breathe or filler words.
 
 NEVER TELL ANYONE YOU ARE AI. YOUR NAME IS SCOTTIE`,
        // text: `For testing purposes, I want you to list ten car brands. Number each item, e.g. "one (or whatever number you are one): the item name".`
      },
    ]);

    if (client.getTurnDetectionType() === 'server_vad') {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
  }, []);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setRealtimeEvents([]);
    setItems([]);
    setMemoryKv({});
    setCoords({
      lat: 37.775593,
      lng: -122.418137,
    });
    setMarker(null);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();
  }, []);

  const deleteConversationItem = useCallback(async (id: string) => {
    const client = clientRef.current;
    client.deleteItem(id);
  }, []);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = async () => {
    setIsRecording(true);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const trackSampleOffset = await wavStreamPlayer.interrupt();
    if (trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      await client.cancelResponse(trackId, offset);
    }
    await wavRecorder.record((data) => client.appendInputAudio(data.mono));
  };

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = async () => {
    setIsRecording(false);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.pause();
    client.createResponse();
  };

  /**
   * Switch between Manual <> VAD mode for communication
   */
  const changeTurnEndType = async (value: string) => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    if (value === 'none' && wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    client.updateSession({
      turn_detection: value === 'none' ? null : { type: 'server_vad' },
    });
    if (value === 'server_vad' && client.isConnected()) {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
    setCanPushToTalk(value === 'none');
  };

  /**
   * Auto-scroll the event logs
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#0099ff',
              10,
              0,
              8
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              '#009900',
              10,
              0,
              8
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;

    // Set instructions
    client.updateSession({ instructions: instructions });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });

    // Add tools
    client.addTool(
      {
        name: 'set_memory',
        description: 'Saves important data about the user into memory.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'The key of the memory value. Always use lowercase and underscores, no other characters.',
            },
            value: {
              type: 'string',
              description: 'Value can be anything represented as a string',
            },
          },
          required: ['key', 'value'],
        },
      },
      async ({ key, value }: { [key: string]: any }) => {
        setMemoryKv((memoryKv) => {
          const newKv = { ...memoryKv };
          newKv[key] = value;
          return newKv;
        });
        return { ok: true };
      }
    );
    client.addTool(
      {
        name: 'get_weather',
        description:
          'Retrieves the weather for a given lat, lng coordinate pair. Specify a label for the location.',
        parameters: {
          type: 'object',
          properties: {
            lat: {
              type: 'number',
              description: 'Latitude',
            },
            lng: {
              type: 'number',
              description: 'Longitude',
            },
            location: {
              type: 'string',
              description: 'Name of the location',
            },
          },
          required: ['lat', 'lng', 'location'],
        },
      },
      async ({ lat, lng, location }: { [key: string]: any }) => {
        setMarker({ lat, lng, location });
        setCoords({ lat, lng, location });
        const result = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m`
        );
        const json = await result.json();
        const temperature = {
          value: json.current.temperature_2m as number,
          units: json.current_units.temperature_2m as string,
        };
        const wind_speed = {
          value: json.current.wind_speed_10m as number,
          units: json.current_units.wind_speed_10m as string,
        };
        setMarker({ lat, lng, location, temperature, wind_speed });
        return json;
      }
    );

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
    });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);
    });

    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);

  /**
   * Render the application
   */
  return (
    <div data-component="ConsolePage">
      <div className="content-top">
        <div className="content-title">
          <img src="/openai-logomark.svg" />
          <span>realtime console</span>
        </div>
        <div className="content-api-key">
          {!LOCAL_RELAY_SERVER_URL && (
            <Button
              icon={Edit}
              iconPosition="end"
              buttonStyle="flush"
              label={`api key: ${apiKey.slice(0, 3)}...`}
              onClick={() => resetAPIKey()}
            />
          )}
        </div>
      </div>
      <div className="content-main">
        <div className="content-logs">
          <div className="content-block events">
            <div className="visualization">
              <div className="visualization-entry client">
                <canvas ref={clientCanvasRef} />
              </div>
              <div className="visualization-entry server">
                <canvas ref={serverCanvasRef} />
              </div>
            </div>
            <div className="content-block-title">events</div>
            <div className="content-block-body" ref={eventsScrollRef}>
              {!realtimeEvents.length && `awaiting connection...`}
              {realtimeEvents.map((realtimeEvent, i) => {
                const count = realtimeEvent.count;
                const event = { ...realtimeEvent.event };
                if (event.type === 'input_audio_buffer.append') {
                  event.audio = `[trimmed: ${event.audio.length} bytes]`;
                } else if (event.type === 'response.audio.delta') {
                  event.delta = `[trimmed: ${event.delta.length} bytes]`;
                }
                return (
                  <div className="event" key={event.event_id}>
                    <div className="event-timestamp">
                      {formatTime(realtimeEvent.time)}
                    </div>
                    <div className="event-details">
                      <div
                        className="event-summary"
                        onClick={() => {
                          // toggle event details
                          const id = event.event_id;
                          const expanded = { ...expandedEvents };
                          if (expanded[id]) {
                            delete expanded[id];
                          } else {
                            expanded[id] = true;
                          }
                          setExpandedEvents(expanded);
                        }}
                      >
                        <div
                          className={`event-source ${
                            event.type === 'error'
                              ? 'error'
                              : realtimeEvent.source
                          }`}
                        >
                          {realtimeEvent.source === 'client' ? (
                            <ArrowUp />
                          ) : (
                            <ArrowDown />
                          )}
                          <span>
                            {event.type === 'error'
                              ? 'error!'
                              : realtimeEvent.source}
                          </span>
                        </div>
                        <div className="event-type">
                          {event.type}
                          {count && ` (${count})`}
                        </div>
                      </div>
                      {!!expandedEvents[event.event_id] && (
                        <div className="event-payload">
                          {JSON.stringify(event, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="content-block conversation">
            <div className="content-block-title">conversation</div>
            <div className="content-block-body" data-conversation-content>
              {!items.length && `awaiting connection...`}
              {items.map((conversationItem, i) => {
                return (
                  <div className="conversation-item" key={conversationItem.id}>
                    <div className={`speaker ${conversationItem.role || ''}`}>
                      <div>
                        {(
                          conversationItem.role || conversationItem.type
                        ).replaceAll('_', ' ')}
                      </div>
                      <div
                        className="close"
                        onClick={() =>
                          deleteConversationItem(conversationItem.id)
                        }
                      >
                        <X />
                      </div>
                    </div>
                    <div className={`speaker-content`}>
                      {/* tool response */}
                      {conversationItem.type === 'function_call_output' && (
                        <div>{conversationItem.formatted.output}</div>
                      )}
                      {/* tool call */}
                      {!!conversationItem.formatted.tool && (
                        <div>
                          {conversationItem.formatted.tool.name}(
                          {conversationItem.formatted.tool.arguments})
                        </div>
                      )}
                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'user' && (
                          <div>
                            {conversationItem.formatted.transcript ||
                              (conversationItem.formatted.audio?.length
                                ? '(awaiting transcript)'
                                : conversationItem.formatted.text ||
                                  '(item sent)')}
                          </div>
                        )}
                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'assistant' && (
                          <div>
                            {conversationItem.formatted.transcript ||
                              conversationItem.formatted.text ||
                              '(truncated)'}
                          </div>
                        )}
                      {conversationItem.formatted.file && (
                        <audio
                          src={conversationItem.formatted.file.url}
                          controls
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="content-actions">
            <Toggle
              defaultValue={false}
              labels={['manual', 'vad']}
              values={['none', 'server_vad']}
              onChange={(_, value) => changeTurnEndType(value)}
            />
            <div className="spacer" />
            {isConnected && canPushToTalk && (
              <Button
                label={isRecording ? 'release to send' : 'push to talk'}
                buttonStyle={isRecording ? 'alert' : 'regular'}
                disabled={!isConnected || !canPushToTalk}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
              />
            )}
            <div className="spacer" />
            <Button
              label={isConnected ? 'disconnect' : 'connect'}
              iconPosition={isConnected ? 'end' : 'start'}
              icon={isConnected ? X : Zap}
              buttonStyle={isConnected ? 'regular' : 'action'}
              onClick={
                isConnected ? disconnectConversation : connectConversation
              }
            />
          </div>
        </div>
        <div className="content-right">
          <div className="content-block map">
            <div className="content-block-title">get_weather()</div>
            <div className="content-block-title bottom">
              {marker?.location || 'not yet retrieved'}
              {!!marker?.temperature && (
                <>
                  <br />
                  🌡️ {marker.temperature.value} {marker.temperature.units}
                </>
              )}
              {!!marker?.wind_speed && (
                <>
                  {' '}
                  🍃 {marker.wind_speed.value} {marker.wind_speed.units}
                </>
              )}
            </div>
            <div className="content-block-body full">
              {coords && (
                <Map
                  center={[coords.lat, coords.lng]}
                  location={coords.location}
                />
              )}
            </div>
          </div>
          <div className="content-block kv">
            <div className="content-block-title">set_memory()</div>
            <div className="content-block-body content-kv">
              {JSON.stringify(memoryKv, null, 2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
