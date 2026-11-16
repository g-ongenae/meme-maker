// The Diagrams category: a funny take on each sample diagram of the Mermaid
// live editor (mermaid.live), in the order of its samples menu. A diagram is
// shown as rendered by mermaid.ink, in a few formats (a theme and a look), and
// opens in the editor, ready to edit, in the format on show. Each example is
// checked against Mermaid's parser before it's added.

export interface Diagram {
  id: string;
  /** The diagram type, as mermaid.live's samples menu names it. */
  type: string;
  name: string;
  code: string;
}

export interface DiagramFormat {
  id: string;
  name: string;
  /** What the format changes, for its tile in the alternatives. */
  description: string;
  /** Mermaid configuration, as typed in the editor's Config tab. */
  config: Record<string, string>;
  /** Background of its pictures (hex, no #): Mermaid's are transparent. */
  background: string;
}

export const FORMATS: readonly DiagramFormat[] = [
  // Empty, like the editor's own default: Mermaid picks per diagram type.
  { id: 'default', name: 'Default', description: 'Mermaid’s defaults', config: {}, background: 'ffffff' },
  {
    id: 'hand-drawn',
    name: 'Hand-drawn',
    description: 'Hand-drawn look',
    config: { look: 'handDrawn' },
    background: 'ffffff',
  },
  {
    id: 'neo',
    name: 'Neo',
    description: 'Neo theme and look',
    config: { theme: 'neo', look: 'neo' },
    background: 'ffffff',
  },
  // Not 'dark': the editor swaps its default themes and their dark variants
  // for the ones that follow its own light or dark mode. The background is the
  // theme's own.
  {
    id: 'dark',
    name: 'Dark',
    description: 'Dark theme',
    config: { theme: 'neo-dark' },
    background: '201f1f',
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Forest theme',
    config: { theme: 'forest' },
    background: 'ffffff',
  },
  {
    id: 'neutral',
    name: 'Neutral',
    description: 'Neutral theme',
    config: { theme: 'neutral' },
    background: 'ffffff',
  },
];

export const EDITOR_URL = 'https://mermaid.live/edit';
export const RENDER_URL = 'https://mermaid.ink';

// URL-safe base64, without padding (js-base64's `fromUint8Array(bytes, true)`,
// which the editor and mermaid.ink use).
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** The editor's state, as it reads it from the URL hash. */
export interface EditorState {
  code: string;
  /** The configuration, as JSON text. */
  mermaid: string;
  updateDiagram: boolean;
  rough: boolean;
  panZoom: boolean;
  grid: boolean;
}

export const editorState = (d: Diagram, format: DiagramFormat): EditorState => ({
  code: d.code,
  mermaid: JSON.stringify(format.config, null, 2),
  updateDiagram: true,
  rough: false,
  panZoom: true,
  grid: true,
});

/** Link opening a diagram in mermaid.live, in a format (Default by default). */
export const editorUrl = (d: Diagram, format: DiagramFormat = FORMATS[0]): string =>
  `${EDITOR_URL}#base64:${base64Url(new TextEncoder().encode(JSON.stringify(editorState(d, format))))}`;

/** The state as pako, the editor's compressed serialization: zlib, then base64. */
export async function pako(state: object): Promise<string> {
  const deflated = new Blob([JSON.stringify(state)]).stream().pipeThrough(new CompressionStream('deflate'));
  return `pako:${base64Url(new Uint8Array(await new Response(deflated).arrayBuffer()))}`;
}

export interface Pictures {
  svg: string;
  png: string;
}

/** Links to a diagram rendered by mermaid.ink in a format, as SVG and PNG. */
export async function pictureUrls(d: Diagram, format: DiagramFormat): Promise<Pictures> {
  const state = await pako({ code: d.code, mermaid: JSON.stringify(format.config) });
  return {
    svg: `${RENDER_URL}/svg/${state}?bgColor=${format.background}`,
    png: `${RENDER_URL}/img/${state}?type=png&bgColor=${format.background}`,
  };
}

// Examples are written flush left and indented like the editor's samples.
const code = (strings: TemplateStringsArray): string => strings.raw[0].trim();

export const DIAGRAMS: readonly Diagram[] = [
  {
    id: 'flowchart',
    type: 'Flowchart',
    name: 'Should I deploy on Friday?',
    code: code`
flowchart TD
    A[Friday, 4:55 PM] --> B{Deploy to prod?}
    B -->|No| C[Go home 🍻]
    B -->|Yes| D{Did the tests pass?}
    D -->|What tests?| E[Deploy anyway]
    D -->|Yes| E
    E --> F{Is prod on fire?}
    F -->|No| C
    F -->|Yes 🔥| G[Cancel weekend plans]
    G --> H[git revert]
    H --> F
`,
  },
  {
    id: 'c4',
    type: 'C4',
    name: 'Office coffee machine architecture',
    code: code`
C4Context
    title System Context diagram for the Office Coffee Machine
    Enterprise_Boundary(office, "Open space") {
        Person(dev, "Developer", "Turns coffee into code.")
        Person(pm, "Product Manager", "Turns coffee into meetings.")
        Person_Ext(intern, "Intern", "Was asked to refill the beans. Did not.")

        System(machine, "Coffee Machine 3000", "Brews coffee. Sometimes just makes noise.")

        System_Boundary(kitchen, "Kitchen") {
            SystemDb(beans, "Bean storage", "Always empty on Monday morning.")
            SystemQueue(queue, "The queue", "Six people, one cup.")
        }

        System_Ext(chat, "#kitchen channel", "Where the oat milk thief is hunted down.")
    }

    Rel(dev, queue, "Waits in")
    Rel(pm, queue, "Cuts in")
    Rel(queue, machine, "Feeds")
    Rel(machine, beans, "Reads from", "grinder")
    Rel(machine, chat, "Error 42: descale me", "beep")
    BiRel(intern, chat, "Gets blamed in")
`,
  },
  {
    id: 'ishikawa',
    type: 'Ishikawa',
    name: 'Why is the build red?',
    code: code`
ishikawa-beta
    The build is red
    Process
        Merged without review
        Quick fix on a Friday
    People
        Someone force-pushed to main
        Works on my machine
    Equipment
        LAPTOP
            47 browser tabs
            Last rebooted in March
        CI runner out of disk
    Environment
        Mercury in retrograde
        node_modules heavier than a black hole
`,
  },
  {
    id: 'kanban',
    type: 'Kanban',
    name: 'The honest sprint board',
    code: code`
kanban
  todo[Todo]
    docs[Write the documentation]@{ priority: 'Very Low' }
    tests[Add tests later]
  inProgress[In progress]
    rewrite[Rewrite it all in Rust]@{ assigned: 'Intern', priority: 'Very High' }
  blocked[Blocked]
    api[Waiting for the API team since 2019]@{ ticket: 404 }
  done[Done]
    meeting[Meeting about the meeting]@{ assigned: 'Everyone' }
    coffee[Coffee]@{ priority: 'High' }
`,
  },
  {
    id: 'class',
    type: 'Class',
    name: 'The developer hierarchy',
    code: code`
classDiagram
    Developer <|-- SeniorDeveloper
    Developer <|-- Intern
    Developer : +int coffeeLevel
    Developer : +String excuse
    Developer: +googleTheError()
    Developer: +blameTheCache()
    class SeniorDeveloper{
      +int yearsOfTrauma
      +sayItDepends()
      +rejectPullRequest()
    }
    class Intern{
      -bool hasProdAccess
      +dropDatabase()
    }
    class Cat{
      +sitOnKeyboard()
    }
    Cat ..> Developer : distracts
`,
  },
  {
    id: 'sequence',
    type: 'Sequence',
    name: 'Getting a code review',
    code: code`
sequenceDiagram
    actor Me
    participant Reviewer
    participant CI
    Me->>+Reviewer: Quick review? It's a one-liner 🙏
    Reviewer-->>Me: 2,000 lines changed?!
    Me->>CI: Please be green
    CI-->>Me: ❌ Lint: missing comma
    Me->>CI: Please be green 🥺
    CI-->>Me: ✅
    Reviewer-->>-Me: LGTM 👍
    Note over Me,Reviewer: Nobody read it. Ships to prod.
`,
  },
  {
    id: 'pie',
    type: 'Pie',
    name: 'What my job actually is',
    code: code`
pie title What my job actually is
    "Meetings about work" : 40
    "Waiting for CI" : 25
    "Fixing the CI" : 15
    "Googling the error" : 15
    "Writing code" : 5
`,
  },
  {
    id: 'user-journey',
    type: 'User Journey',
    name: 'My Monday',
    code: code`
journey
    title My Monday
    section Morning
      Snooze the alarm 5 times: 5: Me
      Find out there is no coffee: 1: Me, Coffee machine
      Stand-up meeting: 2: Me, Team
    section Afternoon
      Post-lunch food coma: 3: Me
      Fix a bug: 4: Me
      Create two new bugs: 1: Me, QA
    section Evening
      Go home: 5: Me, Cat
`,
  },
  {
    id: 'mindmap',
    type: 'Mindmap',
    name: 'Excuses for being late',
    code: code`
mindmap
  root((Excuses for being late))
    Transport
      ::icon(fa fa-train)
      The train was late
      The train was early
      A goose blocked the road
    Technology
      My alarm did not ring
      Phone updated overnight
        Update 1 of 347
    Pets
      The cat sat on my keys
      The dog ate my badge
    Honest
      I just did not want to
`,
  },
  {
    id: 'requirement',
    type: 'Requirement',
    name: 'Pizza party requirements',
    code: code`
requirementDiagram

    requirement pizza_party {
        id: 1
        text: The team shall be fed after shipping on time.
        risk: high
        verifymethod: test
    }

    functionalRequirement no_pineapple {
        id: 1.1
        text: Pineapple shall be kept away from the pizza.
        risk: medium
        verifymethod: inspection
    }

    performanceRequirement delivery_time {
        id: 1.2
        text: Pizza arrives within 30 minutes or it is free.
        risk: medium
        verifymethod: demonstration
    }

    designConstraint slice_count {
        id: 1.3
        text: Slices shall outnumber developers.
        risk: high
        verifymethod: analysis
    }

    element pizza_box {
        type: cardboard
        docRef: "menu/margherita"
    }

    element hungry_devs {
        type: "test suite"
        docRef: "chat/random"
    }

    pizza_party - contains -> no_pineapple
    pizza_party - contains -> delivery_time
    delivery_time - derives -> slice_count
    pizza_box - satisfies -> slice_count
    hungry_devs - verifies -> pizza_party
`,
  },
  {
    id: 'radar',
    type: 'Radar',
    name: 'Choose your developer',
    code: code`
---
title: "Choose your developer"
---
radar-beta
  axis coffee["Coffee intake"], bugs["Bugs written"], meetings["Meetings survived"]
  axis copy["Copy-pasting"], dark["Dark mode"], excuses["Excuses"]
  curve junior["Junior"]{60, 95, 30, 100, 80, 40}
  curve senior["Senior"]{100, 70, 95, 60, 100, 90}

  max 100
  min 0
`,
  },
  {
    id: 'state',
    type: 'State',
    name: 'A day in the life of a cat',
    code: code`
stateDiagram-v2
    [*] --> Sleeping
    Sleeping --> Eating : food bag noise
    Eating --> Sleeping
    Eating --> Judging : bowl half empty
    Judging --> Sleeping
    Sleeping --> Zoomies : 3 AM
    Zoomies --> KnockingThingsOff
    KnockingThingsOff --> Sleeping : tired now
`,
  },
  {
    id: 'entity-relationship',
    type: 'Entity Relationship',
    name: 'The office fridge',
    code: code`
erDiagram
    COWORKER ||--o{ LUNCH : brings
    COWORKER }o--o{ LUNCH : steals
    FRIDGE ||--|{ LUNCH : contains
    LUNCH ||--o| STICKY_NOTE : "labelled with"
    COWORKER {
        string name
        int sandwichesStolen
        bool guilty
    }
    LUNCH {
        string id PK
        string owner FK
        date expiresAt "three weeks ago"
    }
    STICKY_NOTE {
        string message "DO NOT EAT. I KNOW WHO YOU ARE"
    }
    FRIDGE {
        int smellLevel "over 9000"
    }
`,
  },
  {
    id: 'git',
    type: 'Git',
    name: 'Commit history of a hotfix',
    code: code`
gitGraph
    commit id: "initial commit"
    commit id: "fix typo"
    branch feature
    checkout feature
    commit id: "wip"
    commit id: "wip 2"
    commit id: "asdfgh"
    checkout main
    commit id: "fix typo again"
    merge feature id: "it works, do not touch" tag: "v1.0"
    commit id: "fix prod" type: HIGHLIGHT
    commit id: "revert fix prod" type: REVERSE
    commit id: "please work"
`,
  },
  {
    id: 'architecture',
    type: 'Architecture',
    name: 'Enterprise-grade Hello World',
    code: code`
architecture-beta
    group cloud(cloud)[Enterprise cloud]

    service user(internet)[Our one user]
    service lb(server)[Load balancer] in cloud
    service hello(server)[Hello microservice] in cloud
    service world(server)[World microservice] in cloud
    service db(database)[Greetings database] in cloud
    service backups(disk)[Backups never tested] in cloud

    user:R --> L:lb
    lb:R --> L:hello
    hello:R --> L:world
    hello:B --> T:db
    db:R -- L:backups
`,
  },
  {
    id: 'xy',
    type: 'XY',
    name: 'Productivity vs. days of the week',
    code: code`
xychart-beta
    title "Lines of code (bars) vs. motivation (line)"
    x-axis [Mon, Tue, Wed, Thu, Fri]
    y-axis "Percent of a good day" 0 --> 100
    bar [10, 60, 85, 70, 2]
    line [5, 40, 60, 80, 100]
`,
  },
  {
    id: 'sankey',
    type: 'Sankey',
    name: 'Where my salary goes',
    code: code`
sankey-beta

Salary,Rent,1400
Salary,Food,500
Salary,Coffee,220
Salary,Subscriptions I forgot about,180
Salary,Savings,10
Food,Groceries,200
Food,Delivery at 2 AM,300
Coffee,Fancy oat latte,180
Coffee,Office coffee,40
`,
  },
  {
    id: 'gantt',
    type: 'Gantt',
    name: 'A two-week sprint, realistically',
    code: code`
gantt
    title A two-week sprint, realistically
    dateFormat YYYY-MM-DD
    axisFormat %b %d
    tickInterval 1week
    excludes weekends
    section Plan
        Estimate the tasks     :done, estimate, 2025-01-06, 1d
        Argue about estimates  :done, argue, after estimate, 3d
    section Build
        Actually code          :crit, build, after argue, 2d
        Fix merge conflicts    :conflicts, after build, 3d
        Panic                  :active, panic, after argue, 6d
    section Ship
        Demo                   :milestone, after conflicts, 0d
`,
  },
  {
    id: 'timeline',
    type: 'Timeline',
    name: 'History of my side project',
    code: code`
timeline
    title History of my side project
    Day 1 : Bought the domain name
          : Designed a logo
    Day 2 : Set up a monorepo, CI and Kubernetes
    Day 3 : Rewrote it with a new framework
    Week 2 : Lost motivation
    Year 3 : Renewed the domain name
           : Still no code
`,
  },
  {
    id: 'quadrant',
    type: 'Quadrant',
    name: 'Office snacks, ranked',
    code: code`
quadrantChart
    title Office snacks, ranked
    x-axis Healthy --> Delicious
    y-axis Cheap --> Expensive
    quadrant-1 Treat yourself
    quadrant-2 Why does this exist
    quadrant-3 Sad desk lunch
    quadrant-4 Best value
    Kale chips: [0.10, 0.80]
    Fancy chocolate: [0.85, 0.90]
    Carrot sticks: [0.25, 0.20]
    Rice cakes: [0.15, 0.35]
    Cold pizza: [0.80, 0.25]
    Leftover birthday cake: [0.95, 0.08]
`,
  },
  {
    id: 'packet',
    type: 'Packet',
    name: 'A developer brain packet',
    code: code`
---
title: "Developer brain packet"
---
packet
0-15: "Song stuck in head"
16-31: "Open browser tabs"
32-63: "Thing I forgot to do"
64-95: "Meeting I should be in right now"
96-99: "Focus"
100-105: "Reserved"
106: "😴"
107: "☕"
108: "🍕"
109: "🐛"
110: "🔥"
111: "🚀"
112-127: "Window (chat)"
128-143: "Checksum (vibes)"
144-159: "Urgent pointer"
160-191: "Excuses (padding)"
`,
  },
  {
    id: 'block',
    type: 'Block',
    name: 'Modern digital infrastructure',
    code: code`
block-beta
  columns 3
  company["🏢 Billion-dollar company"]:3
  front["Shiny frontend"] micro["Microservices"] ai["AI ✨"]
  npm["2,184 npm packages"]:3
  space:2 hero["One package from 2009, kept alive by a single volunteer"]

  style company fill:#bbdefb,stroke:#1e88e5
  style hero fill:#ffcdd2,stroke:#e53935
`,
  },
  {
    id: 'treemap',
    type: 'Treemap',
    name: 'Where my free time goes',
    code: code`
treemap-beta
"My free time"
    "Screens"
        "Scrolling": 12
        "Watching just one episode": 9
        "Choosing what to watch": 4
    "Chores"
        "Laundry": 2
        "Thinking about doing laundry": 5
    "Hobbies"
        "Buying gear for my hobby": 3
        "Doing my hobby": 1
    "Sleep": 10
`,
  },
  {
    id: 'use-case',
    type: 'Use Case',
    name: 'The office printer',
    code: code`
usecase-beta
actor Employee("Employee")
actor Support("IT support")
systemBoundary "Office printer"
  Print("Print a document")
  Jam("Jam")
  LoadLetter("PC LOAD LETTER")
end
Employee --> Print
Employee --> Jam
Support --> Jam
Support -- "turns it off and on again" --> LoadLetter
`,
  },
  {
    id: 'event-modeling',
    type: 'Event Modeling',
    name: 'Ordering a pizza',
    code: code`
eventmodeling

tf 01 ui PizzaApp
tf 02 cmd OrderPizza
tf 03 evt PizzaOrdered
tf 04 rmo DeliveryTracker ->> 03
tf 05 ui StareAtTheDoor
tf 06 cmd EatThePizza
tf 07 evt PizzaEaten
tf 08 rmo Regret ->> 07
`,
  },
  {
    id: 'venn',
    type: 'Venn',
    name: 'Fast, cheap, good: pick two',
    code: code`
venn-beta
    title "Pick two"
    set Fast
    set Cheap
    set Good
    union Fast,Cheap["Sloppy"]
    union Cheap,Good["Late"]
    union Fast,Good["Pricey"]
    union Fast,Cheap,Good["🦄"]
`,
  },
  {
    id: 'tree-view',
    type: 'TreeView',
    name: 'My project folder',
    code: code`
treeView-beta
            final-project/
                final.docx
                final-v2.docx
                final-v2-REAL.docx
                FINAL-FINAL-use-this-one.docx
                old/
                    do-not-delete/
                        final.docx
                "Screenshot (37).png"
                node_modules/
`,
  },
  {
    id: 'wardley',
    type: 'Wardley',
    name: 'Student dinner value chain',
    code: code`
wardley-beta
title Student Dinner
size [1100, 800]

anchor Hungry student [0.95, 0.60]
component Dinner [0.82, 0.55]
component Instant noodles [0.70, 0.85]
component Hot water [0.55, 0.80]
component Kettle [0.40, 0.75]
component Microwave [0.42, 0.88]
component Cooking skills [0.30, 0.10]
component Parents [0.15, 0.30]

Hungry student -> Dinner
Dinner -> Instant noodles
Dinner -> Cooking skills
Instant noodles -> Hot water
Hot water -> Kettle
Hot water -> Microwave
Cooking skills -> Parents

evolve Cooking skills 0.35

note "Cooking skills still in genesis since 2019" [0.22, 0.20]
`,
  },
  {
    id: 'cynefin',
    type: 'Cynefin',
    name: 'Fixing production',
    code: code`
cynefin-beta
  title Fixing production

  complex
    "Why is it slow only on Tuesdays?"
    "Flaky test"

  complicated
    "Read the logs"
    "Ask the senior dev"

  clear
    "Turn it off and on again"
    "Clear the cache"

  chaotic
    "Prod is down during the CEO demo"

  confusion
    "Works on my machine"

  complex --> complicated : "Found a stack trace"
  clear --> chaotic : "Cleared the wrong cache"
`,
  },
  {
    id: 'railroad',
    type: 'Railroad (IR)',
    name: 'How to decline a meeting',
    code: code`
railroad-beta
    title How to decline a meeting

    reply = sequence(
        optional(terminal("Sorry,")),
        choice(
            terminal("I have a conflict"),
            terminal("could this be an email?"),
            terminal("I am out of office")
        ),
        zeroOrMore(terminal("🙏"))
    ) ;
`,
  },
  {
    id: 'railroad-ebnf',
    type: 'Railroad (EBNF)',
    name: 'A task estimate',
    code: code`
railroad-ebnf-beta
    title A task estimate

    estimate = "It is" status ( "," excuse )* ;
    status = "a quick fix" | "almost done" | "basically finished" ;
    excuse = "just one more test" | "the API changed" | "it depends" ;
`,
  },
  {
    id: 'railroad-abnf',
    type: 'Railroad (ABNF)',
    name: 'A password IT will accept',
    code: code`
railroad-abnf-beta
    title A password IT will accept

    password = word 2*DIGIT symbol [ "!" ] ;
    word = "Password" / "Summer" / "Qwerty" ;
    symbol = "!" / "#" / "$" ;
`,
  },
  {
    id: 'railroad-peg',
    type: 'Railroad (PEG)',
    name: 'A coffee order',
    code: code`
railroad-peg-beta
    title A coffee order

    Order <- Size Milk? Extra* "coffee" ;
    Size <- "small" / "medium" / "venti grande supreme" ;
    Milk <- "oat" / "almond" / "regular" ;
    Extra <- "extra shot" / "caramel drizzle" / "pumpkin spice" ;
`,
  },
  {
    id: 'swimlane',
    type: 'Swimlane',
    name: 'Pushing on Friday evening',
    code: code`
swimlane-beta LR
  subgraph dev [Developer]
    push[Push on Friday evening]
    sleep([Go to sleep])
  end

  subgraph ci [CI]
    build{Build passes?}
  end

  subgraph oncall [On-call]
    pager((Phone rings at 3 AM))
    revert[Revert]
  end

  push --> build
  build -->|Yes| sleep
  build -->|No| pager
  pager --> revert --> sleep
`,
  },
];
