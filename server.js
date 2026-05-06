const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { GoogleGenAI } = require('@google/genai');
const mammoth = require('mammoth');
require('dotenv').config();

// Helper function to extract text from various file types
async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.docx') {
    // Use mammoth to extract text from .docx files
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } else if (ext === '.doc') {
    // .doc files are harder to parse - try reading as text, warn if garbled
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Check if it looks like binary garbage
      if (content.includes('\u0000') || content.includes('\ufffd')) {
        throw new Error('Old .doc format detected. Please convert to .docx or .txt for better results.');
      }
      return content;
    } catch (e) {
      throw new Error('Cannot read .doc file. Please convert to .docx or paste the text directly.');
    }
  } else {
    // Plain text files (.txt, etc.)
    return fs.readFileSync(filePath, 'utf-8');
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Helper function to format offer context for the AI prompt
function formatOfferContext(offerContext) {
  if (!offerContext) return '';

  let offerPrompt = `

=== OFFER/PRODUCT CONTEXT ===
The seller was presenting the following offer:

**Offer Name:** ${offerContext.name || 'Not specified'}
**Price:** ${offerContext.price || 'Not specified'}

**Key Features/Deliverables:**
${offerContext.features?.length ? offerContext.features.map(f => `- ${f}`).join('\n') : 'Not specified'}

**Ideal Client Profile:**
${offerContext.idealClient || 'Not specified'}

**Common Objections:**
${offerContext.commonObjections?.length ? offerContext.commonObjections.map(o => `- ${o}`).join('\n') : 'Not specified'}

**Value Propositions:**
${offerContext.valuePropositions?.length ? offerContext.valuePropositions.map(v => `- ${v}`).join('\n') : 'Not specified'}

=== OFFER-AWARE ANALYSIS INSTRUCTIONS ===
With this offer context, enhance your analysis:

1. **Prospect-Offer Fit**: Assess if this prospect matches the ideal client profile. Did the seller properly qualify the prospect for THIS specific offer?

2. **Price Anchoring**: Did the seller properly establish value before presenting the ${offerContext.price || 'price'} price point? Was the gap quantified to justify the investment?

3. **Feature Presentation**: Which features did the seller highlight? Were they aligned with the prospect's stated pain points?

4. **Objection Anticipation**: Based on common objections for this offer, did the seller preemptively address them? If objections arose, were they handled effectively?

5. **Value Proposition Delivery**: Did the seller clearly articulate the value propositions? Were they personalized to the prospect's situation?

6. **Missed Offer Opportunities**: What aspects of this offer could have been leveraged better to advance the sale?

Include an "offerAnalysis" section in your JSON response:
{
  "offerAnalysis": {
    "prospectFitScore": 1-10,
    "prospectFitRationale": "explanation of fit/misfit with ideal client profile",
    "priceHandling": "how price was presented and if value was established first",
    "featuresHighlighted": ["feature1", "feature2"],
    "featuresNotMentioned": ["feature3", "feature4"],
    "objectionPreparation": "assessment of objection handling vs known objections",
    "valuePropsDelivered": ["prop1"],
    "valuePropsNotDelivered": ["prop2"],
    "offerSpecificRecommendations": ["recommendation1", "recommendation2"]
  }
}

=== END OFFER CONTEXT ===`;

  return offerPrompt;
}

// Sales Coach CALM Methodology Prompt with Elite Sales Framework
const SALES_COACH_PROMPT = `You are an elite sales coach analyzing recorded sales calls using the ELITE SALES FRAMEWORK. Your analysis will provide specific, actionable recovery tactics to win back or advance sales opportunities.

CRITICAL GRADING RULE - OUTCOME OVER TECHNIQUE:
Grade based on DEAL LIKELIHOOD, not technique perfection. A deal can close with imperfect methodology if buying signals are strong.

TALK RATIO GUIDANCE (not hard penalty):
- Ideal: Seller 20-30%, Buyer 70-80%
- If seller >70%: Flag as concern, but do NOT auto-cap grade if strong buying signals present
- Buying signals override talk ratio penalties

=== ELITE SALES FRAMEWORK ANALYSIS ===

BUYER'S JOURNEY STAGE DETECTION (Critical - determines all recommendations):
Analyze the conversation to determine which stage the prospect is in:

**TOFU (Top of Funnel) - AWARENESS STAGE**
- Prospect thinking: "Do I even have a problem?"
- Language signals: "I'm struggling with...", "I don't know where to start", "I've noticed..."
- Appropriate approach: CURIOSITY (don't pitch yet!)
- If seller pitched to TOFU prospect = critical mistake

**MOFU (Middle of Funnel) - CONSIDERATION STAGE**
- Prospect thinking: "Can this be solved? By you?"
- Language signals: "I've been looking at...", "I've tried X but...", "How is this different?"
- Appropriate approach: AUTHENTICITY (differentiate, build trust)
- Focus: Build trust, show you're different, address objections

**BOFU (Bottom of Funnel) - DECISION STAGE**
- Prospect thinking: "Is this the best option? Am I ready?"
- Language signals: "I'm ready to...", "When could we start?", "What happens after I sign up?"
- Appropriate approach: MOMENTUM (guide to close)
- If seller kept questioning BOFU prospect = missed closing opportunity

THE 7 DECISION POINTS CASCADE (Diagnose which failed):
Every prospect must pass ALL 7 points to buy. Identify which failed:

1. "Do I have a real problem?" - Test: "What made you reach out now?" (If "just exploring" = FAILED)
2. "Is it worth solving?" - Test: "What happens if nothing changes in 6 months?" (If "I'll be fine" = FAILED)
3. "Does a solution exist?" - Test: "What have you tried?" (If "nothing works" = FAILED)
4. "Have others like me succeeded?" - Test: "Have you seen similar people solve this?" (If "they're different" = FAILED)
5. "Is THIS solution better than alternatives?" - Test: "What are you comparing this to?" (If can't differentiate = FAILED)
6. "Can I trust this person?" - Test: Authenticity, vulnerable stories (If skeptical questions continue = FAILED)
7. "Am I ready to change my identity?" - Test: "What would success look like 90 days from now?" (If can't imagine = FAILED)

When prospect says "I need to think about it" - diagnose WHICH decision point failed, then address that root cause.

PRIMARY ANALYSIS FRAMEWORK - CALM METHOD:
- **C**larify: Uncover problems & pain points with CURIOSITY
- **A**lign: Establish mutual agreement with AUTHENTICITY
- **L**ead: Guide with confidence & credibility
- **M**ove: Secure concrete next steps with MOMENTUM

ENERGY SIGNALS ANALYSIS (Trust energy over words):
- Voice changes: Quieter = uncertainty, Speeds up = excitement/anxiety, Long pauses = processing/resistance
- Language patterns: "I should..." = not convinced, "I need to..." = motivated, "I'll try..." = low commitment, "I will..." = high commitment
- Story vs Solution mode: Still explaining problem (not ready) vs asking logistics/pricing (ready to close)
- Enrollment language: "So if I did this...", "When would I start..." = closing themselves (STOP SELLING)

BUYING SIGNALS ANALYSIS (Can boost grade regardless of technique):
Detect these positive indicators that suggest deal will close:
- Prospect asked about pricing, investment, or cost = STRONG buying signal
- Prospect asked about timeline, start date, or implementation = STRONG buying signal
- Prospect asked "how does this work?" or logistics questions = positive signal
- Follow-up meeting scheduled with specific date/time = VERY STRONG signal
- Prospect expressed excitement, urgency, or enthusiasm = positive signal
- Prospect shared personal pain or vulnerability openly = trust indicator
- Prospect asked to include other stakeholders = expansion signal
- Prospect took notes or asked for materials = engagement signal

BUYING SIGNAL GRADE ADJUSTMENT:
- 3+ strong buying signals: Can earn A/B even with methodology gaps
- 2 strong signals: Can earn B/C even with technique issues
- Excitement + scheduled follow-up = likely to close regardless of talk ratio

IDENTITY-BASED SELLING ASSESSMENT:
- Did they sell features/benefits (low-ticket approach) OR who the prospect becomes (high-ticket approach)?
- Did they help prospect see the bridge from current identity to target identity?
- Identity questions used: "Who do you want to be known as?", "How would that version of you show up differently?"

SECONDARY FRAMEWORKS - APPLY ALL:

1. SPIN SELLING ANALYSIS:
   - Situation questions: Count and quality (gathering context)
   - Problem questions: Count and quality (exploring difficulties)
   - Implication questions: Count and quality (developing seriousness) - MOST IMPORTANT
   - Need-Payoff questions: Count and quality (focusing on value)

2. GAP SELLING ANALYSIS:
   - Current state identified? Future state established? Gap quantified? Solution tied to gap?

3. DISCOVERY DEPTH:
   - Surface: Only asked what they need (weak)
   - Mid: Asked why they need it (average)
   - Root-cause: Explored business impact, cost of inaction (strong)

4. OBJECTION HANDLING (Stage-Specific):
   - TOFU objection "I need to think about it" = "I don't have enough info" → Provide clarity
   - MOFU objection "I need to think about it" = "I'm scared" → Address fear with empathy
   - BOFU objection "I need to think about it" = "Hidden concerns" → Surface: "What's the ONE thing you need to feel 100% confident?"

5. TALK RATIO:
   - Ideal: Seller 20-30%, Buyer 70-80%
   - Acceptable: Seller 30-40%, Buyer 60-70%
   - Poor: Seller 40-60%, Buyer 40-60%
   - High: Seller >60% (flag as concern, but NOT auto-cap if buying signals strong)

IMPORTANT: You MUST respond with valid JSON only. No markdown, no code blocks, no extra text.

=== REQUIRED FIELDS - MUST ALWAYS INCLUDE ===
The following fields are MANDATORY in every response. Do NOT omit them:
1. closingProbability - ALWAYS include with percentage (0-100), confidence, drivers, and blockers
2. dealHealth - ALWAYS include with status (healthy|at-risk|critical), score (1-10), and riskFactors
3. buyingSignals - ALWAYS include with detected signals, strength, and count
4. overallGrade - ALWAYS include (A|B|C|D|F)

If you cannot determine exact values, make your best estimate based on available information.
NEVER return these fields as null, undefined, or empty. Always provide a complete analysis.

OUTPUT FORMAT (respond with this exact JSON structure):
{
  "overallGrade": "A|B|C|D|F",
  "gradeRationale": "2-sentence rationale explaining the grade, mentioning stage match and key factors.",
  "buyerJourneyStage": {
    "detected": "TOFU|MOFU|BOFU",
    "confidence": "high|medium|low",
    "signals": ["specific language/behavior observed"],
    "sellerApproachMatch": "correct|incorrect",
    "feedback": "Was the seller's approach appropriate for this stage?"
  },
  "decisionPointsAnalysis": {
    "failedPoints": [1, 2],
    "passedPoints": [3, 4, 5],
    "unclearPoints": [6, 7],
    "primaryFailure": "The main decision point that blocked the sale",
    "diagnosis": "Specific evidence for why this point failed"
  },
  "talkRatio": {
    "seller": "XX%",
    "buyer": "XX%",
    "assessment": "ideal|acceptable|poor|failing",
    "gradeCapped": true/false
  },
  "calmScorecard": {
    "clarify": { "score": 1-10, "evidence": "specific example" },
    "align": { "score": 1-10, "evidence": "specific example" },
    "lead": { "score": 1-10, "evidence": "specific example" },
    "moveForward": { "score": 1-10, "evidence": "specific example" }
  },
  "energySignals": {
    "observed": ["Key energy shifts noticed during the call"],
    "prospectMode": "story|solution",
    "enrollmentSignals": "Any self-closing language observed",
    "commitmentLevel": "low|medium|high based on language patterns (try vs will)"
  },
  "spinAnalysis": {
    "situationQuestions": { "count": 0, "quality": "weak|average|strong", "examples": ["example1"] },
    "problemQuestions": { "count": 0, "quality": "weak|average|strong", "examples": ["example1"] },
    "implicationQuestions": { "count": 0, "quality": "weak|average|strong", "examples": ["example1"] },
    "needPayoffQuestions": { "count": 0, "quality": "weak|average|strong", "examples": ["example1"] },
    "overallSpinScore": 1-10
  },
  "gapSellingAnalysis": {
    "currentStateIdentified": true/false,
    "futureStateEstablished": true/false,
    "gapQuantified": true/false,
    "solutionTiedToGap": true/false,
    "overallGapScore": 1-10,
    "evidence": "specific example"
  },
  "discoveryDepth": {
    "level": "surface|mid|root-cause",
    "score": 1-10,
    "evidence": "what depth was reached"
  },
  "objectionHandling": {
    "objectionsRaised": ["objection1"],
    "handlingQuality": "poor|average|good|excellent",
    "preemptiveHandling": true/false,
    "score": 1-10,
    "evidence": "how objections were handled"
  },
  "criticalMistakes": [
    { "mistake": "description", "timestamp": "MM:SS", "impact": "why it matters", "methodology": "Elite Sales Framework violation" }
  ],
  "missedOpportunities": [
    { "opportunity": "what they missed", "timestamp": "MM:SS", "suggestedApproach": "what they should have done", "methodology": "framework reference" }
  ],
  "strongMoments": [
    { "moment": "what they did well", "timestamp": "MM:SS", "whyEffective": "explanation", "methodology": "framework reference" }
  ],
  "actionPlan": [
    { "skill": "Specific skill to practice", "priority": "high|medium|low", "exercise": "practice exercise" }
  ],
  "nextStepsToWinBack": [
    {
      "step": "STAGE-SPECIFIC recovery action. TOFU: Re-engage with curiosity question. MOFU: Share tribe-matched case study or vulnerable story. BOFU: Surface hidden objection and assumptive close.",
      "timing": "Within 24-48 hours",
      "rationale": "How this addresses the failed decision point",
      "script": "EXACT words to use in follow-up: 'Hey [Name], I was reflecting on our conversation and wanted to ask - [ROOT QUESTION based on failed decision point]'"
    },
    {
      "step": "Apply cognitive bias technique. Use loss aversion: quantify cost of inaction. Use social proof: share tribe-matched success story.",
      "timing": "During next interaction",
      "rationale": "Which bias this leverages and why it works for this prospect",
      "script": "Specific language: 'Based on what you shared, staying stuck here is costing you roughly [X] per month. In 6 months, that's [Y] you won't get back.'"
    },
    {
      "step": "Identity-based close or stage advancement. Help them see the bridge from current identity to target identity.",
      "timing": "When they show buying signals",
      "rationale": "Ties to Decision Point #7 - identity transformation readiness",
      "script": "'90 days from now, you could be [TARGET IDENTITY]. The question is whether you're ready to become that person. What would make this a HELL YES?'"
    }
  ],
  "guidedQuestionsForNextCall": [
    {
      "question": "ROOT question for their stage. TOFU: 'What happens if nothing changes in 6 months?' MOFU: 'What have you already tried, and what made those not work?' BOFU: 'What's the ONE thing you need to feel 100% confident about this?'",
      "purpose": "Tests specific decision point that failed",
      "category": "discovery|urgency|objection-handling|closing|identity",
      "decisionPoint": 1-7
    },
    {
      "question": "Loss aversion trigger: 'How much is this problem costing you per month in lost revenue/time/opportunity?'",
      "purpose": "Quantifies the gap and activates loss aversion - makes inaction painful",
      "category": "urgency",
      "decisionPoint": 2
    },
    {
      "question": "Social proof setup: 'Have you seen others in your exact situation solve this? What did they do differently?'",
      "purpose": "Tests Decision Point #4 and opens door for your case study",
      "category": "relationship-building",
      "decisionPoint": 4
    },
    {
      "question": "Identity transformation: 'Who do you want to be known as in your market 90 days from now? How would that version of you show up differently?'",
      "purpose": "Tests readiness for identity shift - the real decision in high-ticket sales",
      "category": "identity",
      "decisionPoint": 7
    },
    {
      "question": "Hidden objection surface: 'I sense there might be something holding you back that we haven't discussed. What would need to be true for this to be an absolute YES?'",
      "purpose": "Brings hidden concerns to surface where they can be addressed",
      "category": "objection-handling",
      "decisionPoint": 6
    }
  ],
  "cognitivebiasOpportunities": {
    "lossAversion": "Specific cost of inaction for this prospect - what they lose by not acting",
    "socialProof": "Ideal tribe-matched case study profile that would resonate with this prospect",
    "sunkCost": "If they mentioned past failures, how to reframe: 'That investment wasn't wasted - it taught you what doesn't work'"
  },
  "buyingSignals": {
    "detected": ["list of specific buying signals observed"],
    "strength": "strong|moderate|weak|none",
    "strongSignalCount": 0,
    "gradeBoostApplied": true/false
  },
  "closingProbability": {
    "percentage": 0-100,
    "confidence": "high|medium|low",
    "primaryDrivers": ["top 2-3 factors increasing probability"],
    "primaryBlockers": ["top 2-3 factors decreasing probability"],
    "rationale": "1-2 sentence explanation of the probability score"
  },
  "dealHealth": {
    "status": "healthy|at-risk|critical",
    "score": 1-10,
    "riskFactors": [
      { "risk": "description of risk", "severity": "high|medium|low", "mitigation": "suggested action to address" }
    ],
    "strengthFactors": ["positive indicators for the deal"]
  },
  "winBackProbability": {
    "percentage": 0-100,
    "bestTiming": "When to follow up for best chance",
    "keyAction": "The single most important recovery action",
    "likelihood": "high|medium|low"
  },
  "executiveSummary": "3-4 sentences: Buyer stage detected (TOFU/MOFU/BOFU), which decision point failed, seller approach match, and the #1 recovery action needed."
}

ANALYSIS APPROACH:
1. FIRST: Identify buyer journey stage from language patterns and behavior
2. SECOND: Detect BUYING SIGNALS - count strong signals that indicate deal will close
3. THIRD: Diagnose which of the 7 decision points passed/failed
4. FOURTH: Calculate talk ratio (flag if >60% but don't auto-cap if buying signals strong)
5. FIFTH: Apply CALM and secondary frameworks
6. SIXTH: Calculate CLOSING PROBABILITY (0-100%) based on:
   - Decision points passed (30% weight)
   - Buying signals strength (25% weight)
   - CALM average score (15% weight)
   - Stage-approach match (10% weight)
   - Commitment language (10% weight)
   - Talk ratio (10% weight)
7. SEVENTH: Determine DEAL HEALTH status and risk factors
8. Generate STAGE-SPECIFIC next steps with exact scripts
9. Provide ROOT questions for next call

REMINDER: You MUST include closingProbability.percentage (0-100) and dealHealth.status in EVERY response. These are required fields.

GRADING GUIDELINES (outcome-focused):
- A: 80%+ closing probability, strong buying signals, clear next steps
- B: 60-79% closing probability, good signals, minor gaps to address
- C: 40-59% closing probability, mixed signals, needs work
- D: 20-39% closing probability, few buying signals, major concerns
- F: <20% closing probability, deal likely lost without major intervention

CRITICAL RECOVERY TACTICS BY STAGE:
- TOFU prospects who ghosted: Re-engage with curiosity, NOT pitch. Ask "What made you reach out originally? I want to understand if we can actually help."
- MOFU prospects stuck in consideration: Share vulnerable story + tribe-matched proof. Ask "What would make THIS different from what you've tried before?"
- BOFU prospects who said "I need to think about it": Surface hidden objection. Ask "What's the ONE thing you need to feel 100% confident?" Then address it directly.

Be direct and specific. Every next step should have exact words to say. Focus on recovering THIS deal, not general advice.`;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(os.tmpdir(), 'callcoach-uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB limit
  fileFilter: (req, file, cb) => {
    const allowedVideoMimes = [
      'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo',
      'video/x-flv', 'video/webm', 'video/x-ms-wmv', 'video/3gpp', 'video/mov'
    ];
    const allowedTextMimes = [
      'text/plain', 'text/csv', 'application/json',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword', 'application/pdf'
    ];
    if (allowedVideoMimes.includes(file.mimetype) || file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else if (allowedTextMimes.includes(file.mimetype) || file.fieldname === 'transcript') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video/audio and transcript files are allowed.'));
    }
  }
});

// Multi-file upload for sales analysis (video + optional transcript)
const salesUpload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'video') {
      if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
        cb(null, true);
      } else {
        cb(new Error('Invalid video/audio file type.'));
      }
    } else if (file.fieldname === 'transcript') {
      // Accept common text file types
      cb(null, true);
    } else {
      cb(new Error('Unexpected field.'));
    }
  }
}).fields([
  { name: 'video', maxCount: 1 },
  { name: 'transcript', maxCount: 1 }
]);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Gemini client
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }
  return new GoogleGenAI({ apiKey });
}

// Helper function to wait for file processing
async function waitForFileProcessing(ai, fileName, maxWaitTime = 300000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitTime) {
    const fileInfo = await ai.files.get({ name: fileName });
    if (fileInfo.state === 'ACTIVE') {
      return fileInfo;
    } else if (fileInfo.state === 'FAILED') {
      throw new Error('File processing failed');
    }
    // Wait 2 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('File processing timed out');
}

// API endpoint: Analyze uploaded video file
app.post('/api/analyze-file', upload.single('video'), async (req, res) => {
  let uploadedFile = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const { prompt, startOffset, endOffset, fps } = req.body;
    const ai = getGeminiClient();
    const videoPath = req.file.path;
    const fileSize = req.file.size;

    let videoPart;

    // Use File API for files > 15MB, inline for smaller files
    if (fileSize > 15 * 1024 * 1024) {
      console.log(`Uploading large file (${(fileSize / 1024 / 1024).toFixed(2)} MB) via File API...`);

      // Read file as buffer for upload
      const fileBuffer = fs.readFileSync(videoPath);

      // Upload file using File API with buffer
      uploadedFile = await ai.files.upload({
        file: new Blob([fileBuffer], { type: req.file.mimetype }),
        config: {
          mimeType: req.file.mimetype,
          displayName: req.file.originalname
        }
      });

      console.log(`File uploaded: ${uploadedFile.name}, state: ${uploadedFile.state}`);

      // Wait for file to be processed if not active
      if (uploadedFile.state !== 'ACTIVE') {
        console.log('Waiting for file processing...');
        uploadedFile = await waitForFileProcessing(ai, uploadedFile.name);
        console.log('File processing complete');
      }

      // Build content with file reference
      videoPart = {
        fileData: {
          fileUri: uploadedFile.uri,
          mimeType: uploadedFile.mimeType
        }
      };
    } else {
      // Use inline data for small files
      const videoBytes = fs.readFileSync(videoPath);
      const base64Video = videoBytes.toString('base64');
      videoPart = {
        inlineData: {
          mimeType: req.file.mimetype,
          data: base64Video
        }
      };
    }

    // Add video metadata if provided
    if (fps || startOffset || endOffset) {
      videoPart.videoMetadata = {};
      if (fps) videoPart.videoMetadata.fps = parseFloat(fps);
      if (startOffset) videoPart.videoMetadata.startOffset = startOffset;
      if (endOffset) videoPart.videoMetadata.endOffset = endOffset;
    }

    const contents = [
      videoPart,
      { text: prompt || 'Describe this video in detail.' }
    ];

    console.log('Sending request to Gemini (this may take a few minutes for large videos)...');

    // Retry logic for large video processing with rate limit handling
    let response;
    let retries = 3;
    let waitTime = 5000; // Start with 5 seconds

    while (retries > 0) {
      try {
        response = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: contents,
          config: {
            httpOptions: {
              timeout: 600000 // 10 minute timeout for large videos
            }
          }
        });
        break; // Success, exit retry loop
      } catch (retryError) {
        retries--;
        const errorMsg = retryError.message || '';

        // Check for rate limit (429) error
        if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate')) {
          console.log(`Rate limit hit. Waiting 35 seconds before retry...`);
          waitTime = 35000; // API suggested 30s, we do 35s to be safe
        }

        console.log(`Request failed, ${retries} retries remaining. Waiting ${waitTime/1000}s...`);
        console.log(`Error: ${errorMsg.substring(0, 200)}`);

        if (retries === 0) {
          if (errorMsg.includes('FreeTier')) {
            throw new Error('Rate limit exceeded. Your API key may still be on free tier. Please generate a new API key after enabling billing.');
          }
          throw retryError;
        }
        await new Promise(r => setTimeout(r, waitTime));
        waitTime = Math.min(waitTime * 2, 60000); // Exponential backoff, max 60s
      }
    }

    // Clean up local file
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }

    // Clean up uploaded file from Gemini (optional, files auto-delete after 48h)
    if (uploadedFile) {
      try {
        await ai.files.delete({ name: uploadedFile.name });
      } catch (e) {
        console.log('Note: Could not delete remote file:', e.message);
      }
    }

    res.json({
      success: true,
      response: response.text
    });

  } catch (error) {
    console.error('Error analyzing video file:', error);
    // Clean up local file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    // Try to clean up remote file on error
    if (uploadedFile) {
      try {
        const ai = getGeminiClient();
        await ai.files.delete({ name: uploadedFile.name });
      } catch (e) { /* ignore */ }
    }
    res.status(500).json({
      error: error.message || 'Failed to analyze video'
    });
  }
});

// API endpoint: Analyze YouTube URL
app.post('/api/analyze-youtube', async (req, res) => {
  try {
    const { youtubeUrl, prompt, startOffset, endOffset } = req.body;

    if (!youtubeUrl) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    // Validate YouTube URL
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]+/;
    if (!youtubeRegex.test(youtubeUrl)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const ai = getGeminiClient();

    // Build content parts
    const videoPart = {
      fileData: {
        fileUri: youtubeUrl,
        mimeType: 'video/*'
      }
    };

    // Add video metadata for clipping if provided
    if (startOffset || endOffset) {
      videoPart.videoMetadata = {};
      if (startOffset) videoPart.videoMetadata.startOffset = startOffset;
      if (endOffset) videoPart.videoMetadata.endOffset = endOffset;
    }

    const contents = [
      videoPart,
      { text: prompt || 'Describe this video in detail.' }
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: contents
    });

    res.json({
      success: true,
      response: response.text
    });

  } catch (error) {
    console.error('Error analyzing YouTube video:', error);
    res.status(500).json({
      error: error.message || 'Failed to analyze YouTube video'
    });
  }
});

// API endpoint: Analyze sales call (file upload with optional transcript)
app.post('/api/analyze-sales-call/file', salesUpload, async (req, res) => {
  let uploadedFile = null;
  let videoPath = null;
  let transcriptPath = null;

  try {
    // Check for video file
    if (!req.files || !req.files.video || req.files.video.length === 0) {
      return res.status(400).json({ error: 'No video/audio file uploaded' });
    }

    const videoFile = req.files.video[0];
    videoPath = videoFile.path;
    const fileSize = videoFile.size;

    // Check for optional transcript
    let transcriptContent = null;
    if (req.files.transcript && req.files.transcript.length > 0) {
      transcriptPath = req.files.transcript[0].path;
      console.log(`[Sales] Processing transcript file: ${req.files.transcript[0].originalname}`);
      try {
        transcriptContent = await extractTextFromFile(transcriptPath);
        console.log(`[Sales] Transcript loaded: ${transcriptContent.length} characters`);
      } catch (extractError) {
        console.error(`[Sales] Error extracting transcript: ${extractError.message}`);
        // Continue without transcript rather than failing completely
        transcriptContent = null;
      }
    }

    const { startOffset, endOffset, fps } = req.body;
    const ai = getGeminiClient();

    let videoPart;

    // Use File API for files > 15MB, inline for smaller files
    if (fileSize > 15 * 1024 * 1024) {
      console.log(`[Sales] Uploading large file (${(fileSize / 1024 / 1024).toFixed(2)} MB) via File API...`);

      const fileBuffer = fs.readFileSync(videoPath);
      uploadedFile = await ai.files.upload({
        file: new Blob([fileBuffer], { type: videoFile.mimetype }),
        config: {
          mimeType: videoFile.mimetype,
          displayName: videoFile.originalname
        }
      });

      console.log(`[Sales] File uploaded: ${uploadedFile.name}, state: ${uploadedFile.state}`);

      if (uploadedFile.state !== 'ACTIVE') {
        console.log('[Sales] Waiting for file processing...');
        uploadedFile = await waitForFileProcessing(ai, uploadedFile.name);
        console.log('[Sales] File processing complete');
      }

      videoPart = {
        fileData: {
          fileUri: uploadedFile.uri,
          mimeType: uploadedFile.mimeType
        }
      };
    } else {
      const videoBytes = fs.readFileSync(videoPath);
      const base64Video = videoBytes.toString('base64');
      videoPart = {
        inlineData: {
          mimeType: videoFile.mimetype,
          data: base64Video
        }
      };
    }

    if (fps || startOffset || endOffset) {
      videoPart.videoMetadata = {};
      if (fps) videoPart.videoMetadata.fps = parseFloat(fps);
      if (startOffset) videoPart.videoMetadata.startOffset = startOffset;
      if (endOffset) videoPart.videoMetadata.endOffset = endOffset;
    }

    // Build prompt with optional transcript and offer context
    let fullPrompt = SALES_COACH_PROMPT;
    if (transcriptContent) {
      fullPrompt += `\n\n=== CALL TRANSCRIPT PROVIDED ===\nUse this transcript for precise analysis. Match timestamps from the video with transcript content for accuracy.\n\n${transcriptContent}\n\n=== END TRANSCRIPT ===`;
    }

    // Add offer context if provided
    const offerContext = req.body.offerContext ? JSON.parse(req.body.offerContext) : null;
    if (offerContext) {
      fullPrompt += formatOfferContext(offerContext);
      console.log(`[Sales] Offer context provided: ${offerContext.name}`);
    }

    const contents = [
      videoPart,
      { text: fullPrompt }
    ];

    console.log('[Sales] Sending request to Gemini for sales call analysis...');

    let response;
    let retries = 3;
    let waitTime = 5000;

    while (retries > 0) {
      try {
        response = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: contents,
          config: {
            httpOptions: {
              timeout: 600000
            }
          }
        });
        break;
      } catch (retryError) {
        retries--;
        const errorMsg = retryError.message || '';

        if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate')) {
          console.log(`[Sales] Rate limit hit. Waiting 35 seconds before retry...`);
          waitTime = 35000;
        }

        console.log(`[Sales] Request failed, ${retries} retries remaining. Waiting ${waitTime/1000}s...`);

        if (retries === 0) {
          if (errorMsg.includes('FreeTier')) {
            throw new Error('Rate limit exceeded. Your API key may still be on free tier.');
          }
          throw retryError;
        }
        await new Promise(r => setTimeout(r, waitTime));
        waitTime = Math.min(waitTime * 2, 60000);
      }
    }

    // Clean up local files
    if (videoPath && fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }

    // Clean up uploaded file from Gemini
    if (uploadedFile) {
      try {
        await ai.files.delete({ name: uploadedFile.name });
      } catch (e) {
        console.log('[Sales] Note: Could not delete remote file:', e.message);
      }
    }

    // Parse JSON response
    let analysisData;
    try {
      const responseText = response.text.trim();
      // Remove markdown code blocks if present
      const jsonText = responseText.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      analysisData = JSON.parse(jsonText);
    } catch (parseError) {
      console.log('[Sales] Could not parse JSON, returning raw text');
      analysisData = { rawText: response.text };
    }

    res.json({
      success: true,
      analysis: analysisData
    });

  } catch (error) {
    console.error('[Sales] Error analyzing sales call:', error);
    // Clean up local files on error
    if (videoPath && fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }
    if (uploadedFile) {
      try {
        const ai = getGeminiClient();
        await ai.files.delete({ name: uploadedFile.name });
      } catch (e) { /* ignore */ }
    }
    res.status(500).json({
      error: error.message || 'Failed to analyze sales call'
    });
  }
});

// API endpoint: Analyze sales call (YouTube URL with optional transcript)
app.post('/api/analyze-sales-call/youtube', async (req, res) => {
  try {
    const { youtubeUrl, startOffset, endOffset, transcript, offerContext } = req.body;

    if (!youtubeUrl) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]+/;
    if (!youtubeRegex.test(youtubeUrl)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const ai = getGeminiClient();

    const videoPart = {
      fileData: {
        fileUri: youtubeUrl,
        mimeType: 'video/*'
      }
    };

    if (startOffset || endOffset) {
      videoPart.videoMetadata = {};
      if (startOffset) videoPart.videoMetadata.startOffset = startOffset;
      if (endOffset) videoPart.videoMetadata.endOffset = endOffset;
    }

    // Build prompt with optional transcript and offer context
    let fullPrompt = SALES_COACH_PROMPT;
    if (transcript && transcript.trim()) {
      fullPrompt += `\n\n=== CALL TRANSCRIPT PROVIDED ===\nUse this transcript for precise analysis. Match timestamps from the video with transcript content for accuracy.\n\n${transcript}\n\n=== END TRANSCRIPT ===`;
      console.log(`[Sales] YouTube analysis with transcript: ${transcript.length} characters`);
    }

    // Add offer context if provided
    if (offerContext) {
      fullPrompt += formatOfferContext(offerContext);
      console.log(`[Sales] YouTube offer context provided: ${offerContext.name}`);
    }

    const contents = [
      videoPart,
      { text: fullPrompt }
    ];

    console.log('[Sales] Analyzing YouTube sales call...');

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: contents
    });

    // Parse JSON response
    let analysisData;
    try {
      const responseText = response.text.trim();
      const jsonText = responseText.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      analysisData = JSON.parse(jsonText);
    } catch (parseError) {
      console.log('[Sales] Could not parse JSON, returning raw text');
      analysisData = { rawText: response.text };
    }

    res.json({
      success: true,
      analysis: analysisData
    });

  } catch (error) {
    console.error('[Sales] Error analyzing YouTube sales call:', error);
    res.status(500).json({
      error: error.message || 'Failed to analyze YouTube sales call'
    });
  }
});

// API endpoint: Analyze sales call (transcript only - no audio/video)
const transcriptOnlyUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for text files
  fileFilter: (req, file, cb) => {
    // Accept text file types
    cb(null, true);
  }
}).single('transcript');

app.post('/api/analyze-sales-call/transcript', transcriptOnlyUpload, async (req, res) => {
  let transcriptPath = null;

  try {
    let transcriptContent = '';

    // Check for uploaded transcript file
    if (req.file) {
      transcriptPath = req.file.path;
      console.log(`[Sales Transcript] Processing file: ${req.file.originalname}`);
      try {
        transcriptContent = await extractTextFromFile(transcriptPath);
        console.log(`[Sales Transcript] File loaded: ${transcriptContent.length} characters`);
      } catch (extractError) {
        console.error(`[Sales Transcript] Error extracting text: ${extractError.message}`);
        return res.status(400).json({ error: extractError.message });
      }
    }

    // Check for pasted transcript text
    if (req.body.transcriptText) {
      if (transcriptContent) {
        // Combine file and pasted text if both provided
        transcriptContent += '\n\n--- Additional Text ---\n\n' + req.body.transcriptText;
      } else {
        transcriptContent = req.body.transcriptText;
      }
      console.log(`[Sales Transcript] Text provided: ${req.body.transcriptText.length} characters`);
    }

    if (!transcriptContent || transcriptContent.trim().length === 0) {
      return res.status(400).json({ error: 'No transcript provided. Please upload a file or paste text.' });
    }

    const ai = getGeminiClient();

    // Parse offer context if provided
    const offerContext = req.body.offerContext ? JSON.parse(req.body.offerContext) : null;

    // Modified prompt for transcript-only analysis
    let transcriptPrompt = SALES_COACH_PROMPT + `

=== TRANSCRIPT-ONLY ANALYSIS MODE ===
You are analyzing a TEXT TRANSCRIPT only (no audio/video available).

IMPORTANT ADJUSTMENTS FOR TRANSCRIPT ANALYSIS:
1. Talk ratio should be estimated by counting words/characters per speaker
2. Look for speaker labels like "Seller:", "Rep:", "Agent:", "Prospect:", "Customer:", "Client:", etc.
3. Timestamps may or may not be present - use them if available, otherwise note "N/A" for timestamps
4. Focus heavily on the CONTENT of what was said rather than tone/delivery (which can't be assessed from text)
5. If speaker labels are unclear, make reasonable assumptions and note this in your analysis

=== CALL TRANSCRIPT ===
${transcriptContent}
=== END TRANSCRIPT ===`;

    // Add offer context if provided
    if (offerContext) {
      transcriptPrompt += formatOfferContext(offerContext);
      console.log(`[Sales Transcript] Offer context provided: ${offerContext.name}`);
    }

    console.log('[Sales Transcript] Sending request to Gemini for transcript-only analysis...');

    let response;
    let retries = 3;
    let waitTime = 5000;

    while (retries > 0) {
      try {
        console.log('[Sales Transcript] Calling Gemini API...');
        response = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [{ text: transcriptPrompt }],
          config: {
            httpOptions: {
              timeout: 300000
            }
          }
        });
        console.log('[Sales Transcript] Gemini API responded successfully');
        break;
      } catch (retryError) {
        retries--;
        const errorMsg = retryError.message || '';

        if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate')) {
          console.log(`[Sales Transcript] Rate limit hit. Waiting 35 seconds before retry...`);
          waitTime = 35000;
        }

        console.log(`[Sales Transcript] Request failed, ${retries} retries remaining. Waiting ${waitTime/1000}s...`);

        if (retries === 0) {
          if (errorMsg.includes('FreeTier')) {
            throw new Error('Rate limit exceeded. Your API key may still be on free tier.');
          }
          throw retryError;
        }
        await new Promise(r => setTimeout(r, waitTime));
        waitTime = Math.min(waitTime * 2, 60000);
      }
    }

    // Clean up uploaded file
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }

    // Parse JSON response
    let analysisData;
    try {
      // Handle both function and property access for response.text
      const responseText = typeof response.text === 'function' ? response.text() : response.text;
      console.log('[Sales Transcript] Response length:', responseText?.length || 0);
      const trimmedText = responseText.trim();
      const jsonText = trimmedText.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      analysisData = JSON.parse(jsonText);
      console.log('[Sales Transcript] JSON parsed successfully');
    } catch (parseError) {
      console.log('[Sales Transcript] Could not parse JSON:', parseError.message);
      const rawText = typeof response.text === 'function' ? response.text() : response.text;
      analysisData = { rawText: rawText };
    }

    res.json({
      success: true,
      analysis: analysisData
    });

  } catch (error) {
    console.error('[Sales Transcript] Error analyzing transcript:', error);
    // Clean up on error
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }
    res.status(500).json({
      error: error.message || 'Failed to analyze transcript'
    });
  }
});

// API endpoint: Initiate a Gemini resumable upload session
// Returns an uploadUrl the browser can PUT to directly (no API key in the URL)
app.post('/api/init-upload', async (req, res) => {
  try {
    const { fileName, mimeType, fileSize } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

    const initResponse = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(fileSize),
          'X-Goog-Upload-Header-Content-Type': mimeType || 'video/mp4',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: fileName } }),
      }
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      return res.status(500).json({ error: `Gemini upload init failed: ${errorText}` });
    }

    const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) return res.status(500).json({ error: 'No upload URL returned from Gemini' });

    res.json({ uploadUrl });
  } catch (error) {
    console.error('[Init Upload] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint: Analyze sales call by Gemini file URI (used after direct browser upload)
app.post('/api/analyze-sales-call/uri', async (req, res) => {
  try {
    const { fileUri, mimeType, fileName, offerContext } = req.body;

    if (!fileUri) return res.status(400).json({ error: 'fileUri is required' });

    const ai = getGeminiClient();

    // Poll until Gemini has finished processing the uploaded file
    if (fileName) {
      console.log(`[Sales URI] Waiting for file processing: ${fileName}`);
      try {
        await waitForFileProcessing(ai, fileName);
        console.log('[Sales URI] File ready');
      } catch (e) {
        console.log('[Sales URI] Could not confirm file state, proceeding anyway:', e.message);
      }
    }

    const videoPart = {
      fileData: { fileUri, mimeType: mimeType || 'video/mp4' }
    };

    let fullPrompt = SALES_COACH_PROMPT;
    if (offerContext) {
      fullPrompt += formatOfferContext(offerContext);
    }

    const contents = [videoPart, { text: fullPrompt }];

    console.log('[Sales URI] Sending request to Gemini...');

    let response;
    let retries = 3;
    let waitTime = 5000;

    while (retries > 0) {
      try {
        response = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents,
          config: { httpOptions: { timeout: 600000 } }
        });
        break;
      } catch (retryError) {
        retries--;
        const errorMsg = retryError.message || '';
        if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate')) {
          waitTime = 35000;
        }
        console.log(`[Sales URI] Retry ${retries} remaining. Waiting ${waitTime / 1000}s...`);
        if (retries === 0) throw retryError;
        await new Promise(r => setTimeout(r, waitTime));
        waitTime = Math.min(waitTime * 2, 60000);
      }
    }

    // Clean up the file from Gemini (auto-deletes after 48h if we skip this)
    if (fileName) {
      try { await ai.files.delete({ name: fileName }); } catch (e) {}
    }

    let analysisData;
    try {
      const responseText = response.text.trim();
      const jsonText = responseText.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      analysisData = JSON.parse(jsonText);
    } catch (parseError) {
      analysisData = { rawText: response.text };
    }

    res.json({ success: true, analysis: analysisData });

  } catch (error) {
    console.error('[Sales URI] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze' });
  }
});

// API endpoint: Check API key status
app.get('/api/status', (req, res) => {
  const hasApiKey = !!process.env.GEMINI_API_KEY;
  res.json({
    apiKeyConfigured: hasApiKey,
    message: hasApiKey ? 'API key is configured' : 'GEMINI_API_KEY is not set'
  });
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);

  // Handle multer errors specifically
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum size is 300MB.' });
  }
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field.' });
  }
  if (error.message && error.message.includes('File too large')) {
    return res.status(413).json({ error: 'File too large for Gemini API. Try a shorter video.' });
  }

  res.status(500).json({ error: error.message || 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🎬 Video Understanding App running at http://localhost:${PORT}`);
    console.log(`\nMake sure to set your GEMINI_API_KEY in the .env file!`);
  });
}

module.exports = app;
