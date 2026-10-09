/* SDC Learn — demo catalogue for Skill Development Council Karachi.
   Dates are relative to the day the data is first created so the demo always shows
   past, live ("Today") and upcoming sessions. All accounts below are DEMO accounts. */
const SEED = (() => {
  const day = 86400000;
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const D = n => { const d = new Date(base.getTime() + n * day); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const DT = (n, time = '23:59') => `${D(n)}T${time}`;
  const res = (id, title, file, size) => ({ id, title, type: file.split('.').pop(), url: `assets/resources/${file}`, size });
  const link = (id, title, url) => ({ id, title, type: 'link', url, size: 0 });
  const SAMPLE_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
  const DEMO_PASSWORD = 'Demo@123';

  const users = [
    { id: 'u-admin', role: 'admin', name: 'Sana Mirza', email: 'admin@sdclearn.demo', designation: 'Training Coordinator', phone: '0300-1112233', city: 'Karachi' },
    { id: 'u-faraz', role: 'teacher', name: 'Faraz Ahmed', email: 'instructor@sdclearn.demo', designation: 'Senior Trainer — Data Analytics', specialization: 'Excel, Power BI, Automation', bio: 'Microsoft-certified data analyst with 12 years of corporate training experience.', phone: '0301-2223344', city: 'Karachi' },
    { id: 'u-nida', role: 'teacher', name: 'Nida Hussain', email: 'nida@sdclearn.demo', designation: 'BI Consultant', specialization: 'Tableau, Data Storytelling', bio: 'Tableau Desktop Certified Professional.', phone: '0302-3334455', city: 'Karachi' },
    { id: 'u-kamran', role: 'teacher', name: 'Kamran Sheikh', email: 'kamran@sdclearn.demo', designation: 'Supply Chain Practitioner', specialization: 'Operations, Six Sigma Black Belt', phone: '0303-4445566', city: 'Karachi' },
    { id: 'u-ayesha', role: 'teacher', name: 'Ayesha Siddiqui', email: 'ayesha@sdclearn.demo', designation: 'HSE Lead Trainer', specialization: 'OSHA, NEBOSH, ISO 45001', phone: '0304-5556677', city: 'Karachi' },
    { id: 'u-accounts', role: 'accounts', name: 'Imran Siddiqui', email: 'accounts@sdclearn.demo', designation: 'Accounts Officer', phone: '0305-6667788', city: 'Karachi' },
    { id: 'u-ali', role: 'student', name: 'Ali Raza', email: 'learner@sdclearn.demo', regNo: 'SDC-26-0141', phone: '0311-1234567', city: 'Karachi', education: 'BBA, IBA Karachi' },
    { id: 'u-mariam', role: 'student', name: 'Mariam Khan', email: 'mariam@sdclearn.demo', regNo: 'SDC-26-0142', phone: '0312-2345678', city: 'Karachi', education: 'BS Accounting & Finance' },
    { id: 'u-usman', role: 'student', name: 'Usman Tariq', email: 'usman@sdclearn.demo', regNo: 'SDC-26-0143', phone: '0313-3456789', city: 'Hyderabad', education: 'BE Industrial Engineering' },
    { id: 'u-hira', role: 'student', name: 'Hira Baig', email: 'hira@sdclearn.demo', regNo: 'SDC-26-0144', phone: '0314-4567890', city: 'Karachi', education: 'MBA Marketing' },
    { id: 'u-bilal', role: 'student', name: 'Bilal Qureshi', email: 'bilal@sdclearn.demo', regNo: 'SDC-26-0145', phone: '0315-5678901', city: 'Karachi', education: 'BS Computer Science' },
    { id: 'u-zara', role: 'student', name: 'Zara Hassan', email: 'zara@sdclearn.demo', regNo: 'SDC-26-0146', phone: '0316-6789012', city: 'Karachi', education: 'BS Environmental Sciences' }
  ].map(u => ({ status: 'Active', password: DEMO_PASSWORD, demo: true, joinedAt: D(-60), ...u }));

  const P = (o) => o; // { module: [actions] }
  const roles = [
    { id: 'admin', name: 'Coordinator', base: 'admin', courseScope: 'all', courseIds: [], system: true, description: 'Full access to every module. Always keeps all permissions.', permissions: {} },
    { id: 'teacher', name: 'Instructor', base: 'teacher', courseScope: 'assigned', courseIds: [], system: true, description: 'Teaches assigned courses: sessions, grading, attendance and results.',
      permissions: P({ dashboard: ['view'], courses: ['view', 'edit'], learners: ['view'], submissions: ['view', 'edit'], attendance: ['view', 'edit'], results: ['view', 'edit'], announcements: ['view', 'create', 'edit', 'delete'], messages: ['view', 'create'], calendar: ['view'], ai: ['view', 'use'], quizzes: ['view', 'create', 'edit', 'delete', 'publish'] }) },
    { id: 'student', name: 'Learner', base: 'student', courseScope: 'enrolled', courseIds: [], system: true, description: 'Learns in enrolled courses and tracks their own progress.',
      permissions: P({ learn: ['view'], attendance: ['view'], results: ['view'], certificates: ['view'], fees: ['view'], announcements: ['view'], messages: ['view', 'create'], calendar: ['view'], ai: ['view', 'use'], quizzes: ['view'] }) },
    { id: 'accounts', name: 'Accounts Officer', base: 'admin', courseScope: 'all', courseIds: [], system: false, description: 'Example custom role: manages fees and views learners and reports.',
      permissions: P({ dashboard: ['view'], fees: ['view', 'create', 'edit', 'delete'], learners: ['view'], enrollments: ['view'], reports: ['view'], messages: ['view', 'create'] }) }
  ];

  const divisions = [
    { id: 'DIV-IT', name: 'IT & Data Analytics', code: 'ITD', head: 'Faraz Ahmed', description: 'Office productivity, analytics, BI and automation programs.', status: 'Active' },
    { id: 'DIV-MGT', name: 'Management & Supply Chain', code: 'MSC', head: 'Kamran Sheikh', description: 'Operations, logistics, procurement and quality management.', status: 'Active' },
    { id: 'DIV-HSE', name: 'Health, Safety & Environment', code: 'HSE', head: 'Ayesha Siddiqui', description: 'Occupational health & safety and environmental compliance.', status: 'Active' },
    { id: 'DIV-TRD', name: 'Import, Export & Trade', code: 'IET', head: 'Sana Mirza', description: 'International trade documentation and procedures.', status: 'Active' }
  ];

  const programs = [
    { id: 'PRG-DA', name: 'Certificate in Data Analytics', code: 'CDA', type: 'certificate', divisionId: 'DIV-IT', duration: '3 months', description: 'Hands-on analytics with Excel, Power BI and Tableau.', status: 'Active' },
    { id: 'PRG-SCM', name: 'Diploma in Supply Chain & Operations Management', code: 'DSCM', type: 'diploma', divisionId: 'DIV-MGT', duration: '6 months', description: 'End-to-end supply chain with Lean Six Sigma.', status: 'Active' },
    { id: 'PRG-HSE', name: 'HSE Professional Certificate', code: 'HSEP', type: 'certificate', divisionId: 'DIV-HSE', duration: '6 weeks', description: 'OSHA-aligned workplace safety program.', status: 'Active' },
    { id: 'PRG-WS', name: 'Weekend Workshops', code: 'WKS', type: 'workshop', divisionId: 'DIV-IT', duration: '1–2 days', description: 'Intensive, practical weekend workshops.', status: 'Active' }
  ];

  const zoom = (slug, id) => ({ registerUrl: `https://zoom.us/meeting/register/sdc-${slug}-demo`, meetingId: id, password: 'SDC2026' });

  const courses = [
    {
      id: 'C-EXCEL', slug: 'excel-ai', code: 'DA-101', title: 'Microsoft Excel with AI-Driven Analytics & Automation',
      tagline: 'From clean data to Copilot-assisted dashboards and automated reports.',
      description: 'A practical, project-based course that takes working professionals from Excel fundamentals to modern analytics: dynamic arrays, Power Query, data modelling, dashboards, AI features such as Copilot and Analyze Data, and automation with Office Scripts and macros.',
      level: 'Intermediate', programId: 'PRG-DA', divisionId: 'DIV-IT', programType: 'certificate', delivery: 'hybrid', status: 'published',
      instructorIds: ['u-faraz'], startDate: D(-21), endDate: D(28), icon: 'grid', accent: '#0F766E', fee: 25000,
      duration: '8 weeks · 16 hours', schedule: 'Weekly live class, 7:00–9:00 PM (PKT)', venue: 'Zoom + SDC Karachi Computer Lab',
      outcomes: ['Clean, shape and validate business data with confidence', 'Analyse data with dynamic arrays, XLOOKUP and PivotTables', 'Build repeatable ETL pipelines in Power Query', 'Design interactive dashboards for decision makers', 'Use Copilot and AI features to accelerate analysis', 'Automate recurring reports with Office Scripts and macros'],
      prerequisites: 'Basic computer literacy and access to Microsoft Excel 2021 or Microsoft 365.',
      modules: [
        { name: 'Module 1 · Foundations', summary: 'Data hygiene, structured tables and lookup techniques.' },
        { name: 'Module 2 · Analysis', summary: 'PivotTables and Power Query for repeatable analysis.' },
        { name: 'Module 3 · Modelling & Visualisation', summary: 'Data models, DAX measures and dashboard design.' },
        { name: 'Module 4 · AI & Automation', summary: 'Copilot, Analyze Data, Office Scripts and macros.' }
      ],
      helpUrl: '', zoom: zoom('excel-ai', '812 3456 7890')
    },
    {
      id: 'C-TABLEAU', slug: 'tableau', code: 'DA-102', title: 'Tableau for Data Visualization & Analytics',
      tagline: 'Turn raw data into interactive stories that drive decisions.',
      description: 'Learn to connect, prepare and visualise data in Tableau. Build calculated fields, LOD expressions and interactive dashboards, then publish and share insights with stakeholders.',
      level: 'Beginner', programId: 'PRG-DA', divisionId: 'DIV-IT', programType: 'certificate', delivery: 'online', status: 'published',
      instructorIds: ['u-nida'], startDate: D(-13), endDate: D(22), icon: 'chart', accent: '#1D4ED8', fee: 18000,
      duration: '6 weeks · 12 hours', schedule: 'Tuesdays & Thursdays, 8:00–9:00 PM (PKT)', venue: 'Online via Zoom',
      outcomes: ['Connect to and prepare data sources', 'Build core chart types and maps', 'Write calculated fields and LOD expressions', 'Design interactive dashboards and stories', 'Publish to Tableau Public / Cloud'],
      prerequisites: 'No prior Tableau experience required. Tableau Public (free) installed.',
      modules: [
        { name: 'Module 1 · Getting started', summary: 'Interface, data connections and first charts.' },
        { name: 'Module 2 · Analysis', summary: 'Calculations, filters and parameters.' },
        { name: 'Module 3 · Dashboards & storytelling', summary: 'Interactive dashboards, stories and publishing.' }
      ],
      helpUrl: '', zoom: zoom('tableau', '845 6789 0123')
    },
    {
      id: 'C-SCM', slug: 'supply-chain', code: 'SCM-201', title: 'Diploma in Supply Chain & Operations Management with Six Sigma',
      tagline: 'Plan, source, make and deliver — with Lean Six Sigma discipline.',
      description: 'A comprehensive diploma covering demand planning, procurement, inventory, warehousing, logistics and process improvement using Lean Six Sigma (Green Belt level).',
      level: 'Intermediate', programId: 'PRG-SCM', divisionId: 'DIV-MGT', programType: 'diploma', delivery: 'onsite', status: 'published',
      instructorIds: ['u-kamran'], startDate: D(4), endDate: D(170), icon: 'truck', accent: '#B45309', fee: 65000,
      duration: '6 months · weekends', schedule: 'Saturdays, 10:00 AM–1:00 PM', venue: 'SDC Karachi, Training Hall B',
      outcomes: ['Map and optimise end-to-end supply chains', 'Forecast demand and plan inventory', 'Negotiate and manage suppliers', 'Apply DMAIC to real process problems'],
      prerequisites: 'Graduate degree or 2+ years of industry experience.',
      modules: [
        { name: 'Module 1 · Supply chain fundamentals', summary: 'Strategy, network design and SCOR model.' },
        { name: 'Module 2 · Planning & inventory', summary: 'Forecasting, S&OP and inventory policies.' },
        { name: 'Module 3 · Lean Six Sigma', summary: 'DMAIC, statistical tools and control plans.' }
      ],
      helpUrl: '', zoom: { registerUrl: '', meetingId: '', password: '' }
    },
    {
      id: 'C-PBI', slug: 'power-bi-workshop', code: 'WS-110', title: 'Power BI Essentials — Weekend Workshop',
      tagline: 'Two intensive days from data import to a published report.',
      description: 'A fast-paced weekend workshop introducing Power BI Desktop, data modelling, DAX basics and publishing.',
      level: 'Beginner', programId: 'PRG-WS', divisionId: 'DIV-IT', programType: 'workshop', delivery: 'onsite', status: 'published',
      instructorIds: ['u-faraz'], startDate: D(-45), endDate: D(-44), icon: 'pie', accent: '#C9A227', fee: 8000,
      duration: '2 days · 12 hours', schedule: 'Saturday & Sunday, 10:00 AM–4:00 PM', venue: 'SDC Karachi Computer Lab',
      outcomes: ['Import and transform data', 'Build a star-schema model', 'Create measures with DAX', 'Publish and share a report'],
      prerequisites: 'Comfort with Excel.',
      modules: [{ name: 'Day 1 · Data & model', summary: 'Power Query and modelling.' }, { name: 'Day 2 · Visuals & publishing', summary: 'Report design and sharing.' }],
      helpUrl: '', zoom: { registerUrl: '', meetingId: '', password: '' }
    },
    {
      id: 'C-HSE', slug: 'hse-osha', code: 'HSE-101', title: 'Occupational Health & Safety (OSHA-aligned) Certificate',
      tagline: 'Build a safer workplace with practical hazard control.',
      description: 'Covers hazard identification, risk assessment, incident investigation, PPE, fire safety and legal duties aligned with OSHA and ISO 45001.',
      level: 'All levels', programId: 'PRG-HSE', divisionId: 'DIV-HSE', programType: 'certificate', delivery: 'hybrid', status: 'draft',
      instructorIds: ['u-ayesha'], startDate: D(30), endDate: D(72), icon: 'shield', accent: '#DC2626', fee: 22000,
      duration: '6 weeks', schedule: 'Wednesdays, 6:30–8:30 PM', venue: 'Zoom + SDC Karachi',
      outcomes: ['Identify workplace hazards', 'Conduct risk assessments', 'Investigate incidents', 'Build an HSE management system'],
      prerequisites: 'None.',
      modules: [{ name: 'Module 1 · Safety foundations', summary: 'Legal framework and hazard identification.' }, { name: 'Module 2 · Risk control', summary: 'Assessments, PPE and emergency planning.' }],
      helpUrl: '', zoom: zoom('hse', '867 8901 2345')
    }
  ];

  const S = (id, courseId, order, moduleName, title, date, summary, extra = {}) => ({ id, courseId, order, moduleName, title, date, time: '19:00', duration: '2h', summary, videoUrl: '', resources: [], published: true, statusOverride: '', delivery: '', ...extra });
  const sessions = [
    S('S-EX-1', 'C-EXCEL', 1, 'Module 1 · Foundations', 'Excel foundations & data hygiene', D(-21), 'Structured tables, data types, validation and cleaning techniques.', { videoUrl: SAMPLE_VIDEO, resources: [res('R-EX-1a', 'Session notes — Foundations', 'excel-01-foundations-notes.txt', 703), res('R-EX-1b', 'Practice dataset — Retail sales', 'excel-01-retail-sales.csv', 7450)] }),
    S('S-EX-2', 'C-EXCEL', 2, 'Module 1 · Foundations', 'Lookups, XLOOKUP & dynamic arrays', D(-14), 'XLOOKUP, FILTER, SORT, UNIQUE and spill ranges in practice.', { videoUrl: SAMPLE_VIDEO, resources: [res('R-EX-2a', 'Lookup practice data', 'excel-02-lookup-practice.csv', 2236), link('R-EX-2b', 'Microsoft guide — XLOOKUP function', 'https://support.microsoft.com/en-us/office/xlookup-function-b7fd680e-6d10-43e6-84f9-88eae8bf5929')] }),
    S('S-EX-3', 'C-EXCEL', 3, 'Module 2 · Analysis', 'PivotTables & PivotCharts', D(-7), 'Summarise thousands of rows in seconds; slicers and timelines.', { videoUrl: SAMPLE_VIDEO, resources: [res('R-EX-3a', 'Regional sales dataset', 'excel-03-regional-sales.csv', 4081), res('R-EX-3b', 'Assignment 1 brief', 'excel-03-assignment-brief.txt', 566)] }),
    S('S-EX-4', 'C-EXCEL', 4, 'Module 2 · Analysis', 'Power Query: repeatable data preparation', D(0), 'Combine monthly files, unpivot, merge and refresh with one click.', { resources: [res('R-EX-4a', 'Orders — January', 'excel-04-orders-jan.csv', 2062), res('R-EX-4b', 'Orders — February', 'excel-04-orders-feb.csv', 2080)] }),
    S('S-EX-5', 'C-EXCEL', 5, 'Module 3 · Modelling & Visualisation', 'Data model & DAX measures', D(7), 'Relationships, star schema and your first DAX measures.'),
    S('S-EX-6', 'C-EXCEL', 6, 'Module 3 · Modelling & Visualisation', 'Dashboard design for decision makers', D(14), 'Layout, KPIs, interactivity and visual best practice.'),
    S('S-EX-7', 'C-EXCEL', 7, 'Module 4 · AI & Automation', 'Copilot & AI-assisted analysis', D(21), 'Prompting Copilot, Analyze Data and AI-generated insights.'),
    S('S-EX-8', 'C-EXCEL', 8, 'Module 4 · AI & Automation', 'Automation with Office Scripts & macros', D(28), 'Record, edit and schedule automations for recurring reports.'),

    S('S-TB-1', 'C-TABLEAU', 1, 'Module 1 · Getting started', 'Welcome to Tableau', D(-13), 'Interface tour, connecting to data and building your first view.', { time: '20:00', duration: '1h', videoUrl: SAMPLE_VIDEO, resources: [res('R-TB-1a', 'Getting started guide', 'tableau-01-getting-started.txt', 357), link('R-TB-1b', 'Tableau Public (free download)', 'https://public.tableau.com/')] }),
    S('S-TB-2', 'C-TABLEAU', 2, 'Module 1 · Getting started', 'Core charts & maps', D(-11), 'Bar, line, scatter, maps and when to use each.', { time: '20:00', duration: '1h', videoUrl: SAMPLE_VIDEO, resources: [res('R-TB-2a', 'Superstore sample data', 'tableau-02-superstore-sample.csv', 8251)] }),
    S('S-TB-3', 'C-TABLEAU', 3, 'Module 2 · Analysis', 'Calculated fields & table calculations', D(-6), 'Row-level, aggregate and table calculations.', { time: '20:00', duration: '1h', videoUrl: SAMPLE_VIDEO, resources: [res('R-TB-3a', 'Assignment brief — Sales story', 'tableau-03-assignment-brief.txt', 394)] }),
    S('S-TB-4', 'C-TABLEAU', 4, 'Module 2 · Analysis', 'LOD expressions & parameters', D(-4), 'FIXED, INCLUDE, EXCLUDE and dynamic parameters.', { time: '20:00', duration: '1h', videoUrl: SAMPLE_VIDEO }),
    S('S-TB-5', 'C-TABLEAU', 5, 'Module 3 · Dashboards & storytelling', 'Interactive dashboards', D(2), 'Actions, filters and responsive layouts.', { time: '20:00', duration: '1h' }),
    S('S-TB-6', 'C-TABLEAU', 6, 'Module 3 · Dashboards & storytelling', 'Stories & publishing', D(9), 'Data stories and publishing to Tableau Public.', { time: '20:00', duration: '1h' }),

    S('S-SC-1', 'C-SCM', 1, 'Module 1 · Supply chain fundamentals', 'Orientation & supply chain strategy', D(4), 'Program orientation, SCOR model and competitive strategy.', { time: '10:00', duration: '3h', delivery: 'onsite', resources: [res('R-SC-1a', 'Pre-reading list', 'scm-01-reading-list.txt', 345)] }),
    S('S-SC-2', 'C-SCM', 2, 'Module 1 · Supply chain fundamentals', 'Network design & logistics', D(11), 'Facility location, transportation modes and 3PLs.', { time: '10:00', duration: '3h', delivery: 'onsite' }),
    S('S-SC-3', 'C-SCM', 3, 'Module 2 · Planning & inventory', 'Demand forecasting & S&OP', D(18), 'Forecasting methods, accuracy and S&OP cycles.', { time: '10:00', duration: '3h', delivery: 'onsite' }),
    S('S-SC-4', 'C-SCM', 4, 'Module 3 · Lean Six Sigma', 'DMAIC: Define & Measure', D(25), 'Project charters, SIPOC and measurement systems.', { time: '10:00', duration: '3h', delivery: 'onsite' }),

    S('S-PB-1', 'C-PBI', 1, 'Day 1 · Data & model', 'Power Query & data modelling', D(-45), 'Importing, transforming and modelling sales data.', { time: '10:00', duration: '6h', videoUrl: SAMPLE_VIDEO, resources: [res('R-PB-1a', 'Workshop dataset', 'pbi-01-dataset.csv', 3869)] }),
    S('S-PB-2', 'C-PBI', 2, 'Day 2 · Visuals & publishing', 'Report design & publishing', D(-44), 'Visuals, DAX basics and publishing to the service.', { time: '10:00', duration: '6h', videoUrl: SAMPLE_VIDEO }),

    S('S-HS-1', 'C-HSE', 1, 'Module 1 · Safety foundations', 'Introduction to OHS & legal duties', D(30), 'OSHA principles, duties of employers and employees.', { time: '18:30', resources: [res('R-HS-1a', 'Workplace hazard checklist', 'hse-01-hazard-checklist.txt', 404)] }),
    S('S-HS-2', 'C-HSE', 2, 'Module 1 · Safety foundations', 'Hazard identification', D(37), 'Physical, chemical, biological, ergonomic and psychosocial hazards.', { time: '18:30' }),
    S('S-HS-3', 'C-HSE', 3, 'Module 2 · Risk control', 'Risk assessment & hierarchy of controls', D(44), '5-step risk assessment and control selection.', { time: '18:30' })
  ];

  const assignments = [
    { id: 'A-EX-1', courseId: 'C-EXCEL', batchId: 'B-EX-1', sessionId: 'S-EX-3', title: 'Pivot analysis of regional sales', description: 'Use the regional sales dataset to build a PivotTable report answering the five questions in the brief. Include at least one PivotChart and one slicer.', dueAt: DT(4), maxMarks: 20, lateAllowed: true, status: 'Published' },
    { id: 'A-EX-2', courseId: 'C-EXCEL', batchId: 'B-EX-1', sessionId: 'S-EX-6', title: 'Executive sales dashboard', description: 'Design a one-page interactive dashboard with at least four KPIs and two interactive controls.', dueAt: DT(18), maxMarks: 30, lateAllowed: true, status: 'Published' },
    { id: 'A-EX-W1', courseId: 'C-EXCEL', batchId: 'B-EX-2', sessionId: 'S-EX-3', title: 'Weekend lab: clean a sales export', description: 'Clean the raw sales export (remove duplicates, fix data types, split columns) and submit the tidy workbook.', dueAt: DT(12), maxMarks: 20, lateAllowed: true, status: 'Published' },
    { id: 'A-TB-1', courseId: 'C-TABLEAU', batchId: 'B-TB-1', sessionId: 'S-TB-3', title: 'Superstore sales story', description: 'Build a workbook with three views and one calculated field explaining regional profitability. Submit the packaged workbook (.twbx) or a PDF export.', dueAt: DT(-2), maxMarks: 25, lateAllowed: true, status: 'Published' },
    { id: 'A-SC-1', courseId: 'C-SCM', batchId: 'B-SC-1', sessionId: 'S-SC-2', title: 'Supply chain map of a local company', description: 'Map the supply chain of a Pakistani company of your choice and identify three improvement opportunities.', dueAt: DT(20), maxMarks: 20, lateAllowed: false, status: 'Published' },
    { id: 'A-PB-1', courseId: 'C-PBI', batchId: 'B-PB-1', sessionId: 'S-PB-2', title: 'Workshop report', description: 'Publish your workshop report and submit the .pbix file.', dueAt: DT(-40), maxMarks: 20, lateAllowed: true, status: 'Published' }
  ];

  const batches = [
    { id: 'B-EX-1', courseId: 'C-EXCEL', name: 'Excel AI — Evening (Online)', instructorId: 'u-faraz', startDate: D(-21), endDate: D(28), delivery: 'online', venue: 'Zoom', capacity: 40, status: 'Active' },
    { id: 'B-EX-2', courseId: 'C-EXCEL', name: 'Excel AI — Weekend (Onsite)', instructorId: 'u-faraz', startDate: D(-21), endDate: D(28), delivery: 'onsite', venue: 'SDC Karachi Computer Lab', capacity: 25, status: 'Active' },
    { id: 'B-TB-1', courseId: 'C-TABLEAU', name: 'Tableau — Cohort 3', instructorId: 'u-nida', startDate: D(-13), endDate: D(22), delivery: 'online', venue: 'Zoom', capacity: 40, status: 'Active' },
    { id: 'B-SC-1', courseId: 'C-SCM', name: 'DSCM — Batch 12', instructorId: 'u-kamran', startDate: D(4), endDate: D(170), delivery: 'onsite', venue: 'Training Hall B', capacity: 30, status: 'Active' },
    { id: 'B-PB-1', courseId: 'C-PBI', name: 'Power BI Workshop — Aug', instructorId: 'u-faraz', startDate: D(-45), endDate: D(-44), delivery: 'onsite', venue: 'Computer Lab', capacity: 25, status: 'Completed' }
  ];

  const E = (id, learnerId, courseId, batchId, extra = {}) => ({ id, learnerId, courseId, batchId, enrolledAt: D(-25), accessMode: 'full', allowedSessionIds: [], status: 'Active', ...extra });
  const enrollments = [
    E('EN-01', 'u-ali', 'C-EXCEL', 'B-EX-1'),
    E('EN-02', 'u-ali', 'C-TABLEAU', 'B-TB-1', { accessMode: 'restricted', allowedSessionIds: ['S-TB-1', 'S-TB-2', 'S-TB-3', 'S-TB-5', 'S-TB-6'] }),
    E('EN-03', 'u-ali', 'C-SCM', 'B-SC-1', { enrolledAt: D(-5) }),
    E('EN-04', 'u-ali', 'C-PBI', 'B-PB-1', { status: 'Completed', enrolledAt: D(-50) }),
    E('EN-05', 'u-mariam', 'C-EXCEL', 'B-EX-1'),
    E('EN-06', 'u-mariam', 'C-TABLEAU', 'B-TB-1'),
    E('EN-07', 'u-usman', 'C-EXCEL', 'B-EX-2'),
    E('EN-08', 'u-usman', 'C-SCM', 'B-SC-1', { enrolledAt: D(-3) }),
    E('EN-09', 'u-hira', 'C-TABLEAU', 'B-TB-1'),
    E('EN-10', 'u-bilal', 'C-EXCEL', 'B-EX-1'),
    E('EN-11', 'u-zara', 'C-SCM', 'B-SC-1', { enrolledAt: D(-2) })
  ];

  const submissions = [
    { id: 'SUB-01', assignmentId: 'A-EX-1', sessionId: 'S-EX-3', courseId: 'C-EXCEL', learnerId: 'u-mariam', email: 'mariam@sdclearn.demo', fileName: 'mariam-pivot-analysis.xlsx', fileUrl: 'assets/resources/excel-03-regional-sales.csv', size: 48213, uploadedAt: `${D(-1)}T21:14:00`, status: 'Submitted', grade: null, feedback: '', history: [] },
    { id: 'SUB-02', assignmentId: 'A-TB-1', sessionId: 'S-TB-3', courseId: 'C-TABLEAU', learnerId: 'u-ali', email: 'learner@sdclearn.demo', fileName: 'ali-superstore-story.pdf', fileUrl: 'assets/resources/tableau-03-assignment-brief.txt', size: 312400, uploadedAt: `${D(-3)}T22:40:00`, status: 'Graded', grade: 22, feedback: 'Clear story and good use of colour. Add a reference line to highlight the target next time.', gradedAt: `${D(-1)}T10:00:00`, history: [] },
    { id: 'SUB-03', assignmentId: 'A-TB-1', sessionId: 'S-TB-3', courseId: 'C-TABLEAU', learnerId: 'u-hira', email: 'hira@sdclearn.demo', fileName: 'hira-tableau-story.twbx', fileUrl: 'assets/resources/tableau-03-assignment-brief.txt', size: 1250000, uploadedAt: `${D(-1)}T09:05:00`, status: 'Late', grade: null, feedback: '', history: [] },
    { id: 'SUB-04', assignmentId: 'A-PB-1', sessionId: 'S-PB-2', courseId: 'C-PBI', learnerId: 'u-ali', email: 'learner@sdclearn.demo', fileName: 'ali-workshop-report.pbix', fileUrl: 'assets/resources/pbi-01-dataset.csv', size: 2210000, uploadedAt: `${D(-42)}T18:00:00`, status: 'Graded', grade: 18, feedback: 'Excellent model design.', gradedAt: `${D(-41)}T10:00:00`, history: [] }
  ];

  const att = [];
  const mark = (sessionId, courseId, batchId, map) => Object.entries(map).forEach(([learnerId, status]) => att.push({ id: `AT-${sessionId}-${learnerId}`, sessionId, courseId, batchId, learnerId, status, notes: '', markedBy: 'seed' }));
  mark('S-EX-1', 'C-EXCEL', 'B-EX-1', { 'u-ali': 'Present', 'u-mariam': 'Present', 'u-bilal': 'Present', 'u-usman': 'Present' });
  mark('S-EX-2', 'C-EXCEL', 'B-EX-1', { 'u-ali': 'Present', 'u-mariam': 'Late', 'u-bilal': 'Absent', 'u-usman': 'Present' });
  mark('S-EX-3', 'C-EXCEL', 'B-EX-1', { 'u-ali': 'Absent', 'u-mariam': 'Present', 'u-bilal': 'Absent', 'u-usman': 'Present' });
  mark('S-TB-1', 'C-TABLEAU', 'B-TB-1', { 'u-ali': 'Present', 'u-mariam': 'Present', 'u-hira': 'Present' });
  mark('S-TB-2', 'C-TABLEAU', 'B-TB-1', { 'u-ali': 'Present', 'u-mariam': 'Absent', 'u-hira': 'Present' });
  mark('S-PB-1', 'C-PBI', 'B-PB-1', { 'u-ali': 'Present' });
  mark('S-PB-2', 'C-PBI', 'B-PB-1', { 'u-ali': 'Present' });

  return {
    roles, users, divisions, programs, courses, sessions, assignments, batches, enrollments, submissions, attendance: att,
    progress: [
      { id: 'PRG-1', learnerId: 'u-ali', courseId: 'C-EXCEL', completedSessionIds: ['S-EX-1', 'S-EX-2'], lastSessionId: 'S-EX-3' },
      { id: 'PRG-2', learnerId: 'u-ali', courseId: 'C-TABLEAU', completedSessionIds: ['S-TB-1'], lastSessionId: 'S-TB-2' },
      { id: 'PRG-3', learnerId: 'u-ali', courseId: 'C-PBI', completedSessionIds: ['S-PB-1', 'S-PB-2'], lastSessionId: 'S-PB-2' },
      { id: 'PRG-4', learnerId: 'u-mariam', courseId: 'C-EXCEL', completedSessionIds: ['S-EX-1', 'S-EX-2', 'S-EX-3'], lastSessionId: 'S-EX-3' }
    ],
    results: [
      { id: 'RES-1', learnerId: 'u-ali', courseId: 'C-PBI', assessment: 86, assignmentAvg: 90, attendancePct: 100, finalPct: 90, grade: 'A+', remarks: 'Outstanding participation.', published: true, date: D(-40) }
    ],
    fees: [
      { id: 'FEE-01', learnerId: 'u-ali', courseId: '', type: 'Registration Fee', amount: 2000, dueDate: D(-30), status: 'Paid', paidOn: D(-30), method: 'Bank transfer', reference: 'HBL-88231' },
      { id: 'FEE-02', learnerId: 'u-ali', courseId: 'C-EXCEL', type: 'Course Fee', amount: 25000, dueDate: D(-20), status: 'Paid', paidOn: D(-22), method: 'Bank transfer', reference: 'HBL-88412' },
      { id: 'FEE-03', learnerId: 'u-ali', courseId: 'C-TABLEAU', type: 'Course Fee', amount: 18000, dueDate: D(5), status: 'Pending', paidOn: '', method: '', reference: '' },
      { id: 'FEE-04', learnerId: 'u-ali', courseId: 'C-SCM', type: 'Course Fee', amount: 65000, dueDate: D(3), status: 'Partially Paid', paidOn: D(-4), method: 'Cash', reference: 'RCPT-3301', remarks: 'PKR 30,000 received' },
      { id: 'FEE-05', learnerId: 'u-mariam', courseId: 'C-EXCEL', type: 'Course Fee', amount: 25000, dueDate: D(-20), status: 'Paid', paidOn: D(-21), method: 'Online', reference: 'JC-1182' },
      { id: 'FEE-06', learnerId: 'u-usman', courseId: 'C-SCM', type: 'Course Fee', amount: 65000, dueDate: D(-1), status: 'Overdue', paidOn: '', method: '', reference: '' },
      { id: 'FEE-07', learnerId: 'u-hira', courseId: 'C-TABLEAU', type: 'Course Fee', amount: 18000, dueDate: D(-10), status: 'Paid', paidOn: D(-11), method: 'Bank transfer', reference: 'MCB-5520' }
    ],
    announcements: [
      { id: 'AN-1', title: 'Welcome to SDC Learn', message: 'All live classes, recordings, resources and assignment submissions are now in one place. Use the Help button on any course page if you need support.', audience: 'everyone', courseId: '', priority: 'Important', pinned: true, date: D(-20), expiry: '', status: 'Published', authorId: 'u-admin' },
      { id: 'AN-2', title: 'Power Query session is live tonight', message: 'Join at 7:00 PM via the Zoom button on the course page. Download the January and February order files beforehand.', audience: 'course', courseId: 'C-EXCEL', priority: 'Normal', pinned: false, date: D(-1), expiry: D(1), status: 'Published', authorId: 'u-faraz' },
      { id: 'AN-3', title: 'DSCM Batch 12 orientation', message: 'Orientation for the Supply Chain diploma is on Saturday at 10:00 AM in Training Hall B. Please bring your CNIC for registration.', audience: 'course', courseId: 'C-SCM', priority: 'Normal', pinned: false, date: D(-2), expiry: D(5), status: 'Published', authorId: 'u-admin' }
    ],
    messages: [
      { id: 'MSG-1', from: 'u-faraz', to: 'u-ali', subject: 'Missed PivotTables class', body: 'Hi Ali, I noticed you missed session 3. The recording is available on the session page — please watch it before attempting Assignment 1.', date: `${D(-6)}T10:20:00`, read: false },
      { id: 'MSG-2', from: 'u-ali', to: 'u-nida', subject: 'LOD session access', body: 'Assalam o Alaikum, session 4 shows as locked for me. Could you please check my access?', date: `${D(-3)}T18:02:00`, read: true }
    ],
    notifications: [
      { id: 'N-1', userId: 'u-ali', title: 'Session today: Power Query', message: 'Microsoft Excel with AI-Driven Analytics — 7:00 PM today.', type: 'Session', link: '#/course/C-EXCEL/session/S-EX-4', date: `${D(0)}T08:00:00`, read: false },
      { id: 'N-2', userId: 'u-ali', title: 'Assignment graded', message: 'Superstore sales story — 22/25.', type: 'Grade', link: '#/assignments', date: `${D(-1)}T10:00:00`, read: false },
      { id: 'N-3', userId: 'u-ali', title: 'Fee due soon', message: 'Tableau course fee is due in 5 days.', type: 'Fee', link: '#/fees', date: `${D(-1)}T09:00:00`, read: true },
      { id: 'N-4', userId: 'u-faraz', title: 'New submission', message: 'Mariam Khan submitted "Pivot analysis of regional sales".', type: 'Submission', link: '#/submissions', date: `${D(-1)}T21:14:00`, read: false },
      { id: 'N-5', userId: 'u-admin', title: 'Overdue fee', message: 'Usman Tariq has an overdue course fee.', type: 'Fee', link: '#/fees', date: `${D(0)}T09:00:00`, read: false }
    ],
    certificates: [
      { id: 'CERT-1', code: 'SDC-2026-0001', learnerId: 'u-ali', courseId: 'C-PBI', issuedAt: D(-40), grade: 'A+', status: 'Valid', issuedBy: 'u-admin' }
    ],
    feedback: [
      { id: 'FB-1', learnerId: 'u-mariam', courseId: 'C-EXCEL', rating: 5, comment: 'The Power Query preview alone saved me hours at work. Very practical!', date: D(-2), publish: true }
    ],
    questionBanks: [
      { id: 'QB-EXCEL', courseId: 'C-EXCEL', title: 'Excel foundations bank', description: 'Formative items for Modules 1–2.' }
    ],
    questions: [
      { id: 'QQ-1', bankId: 'QB-EXCEL', courseId: 'C-EXCEL', type: 'mcq_single', stem: 'Which Excel feature best converts a flat range into a structured, auto-expanding table?', options: [{ id: 'a', text: 'PivotTable', correct: false }, { id: 'b', text: 'Format as Table', correct: true }, { id: 'c', text: 'Flash Fill', correct: false }, { id: 'd', text: 'Data Validation', correct: false }], points: 1, difficulty: 'easy', tags: ['tables'] },
      { id: 'QQ-2', bankId: 'QB-EXCEL', courseId: 'C-EXCEL', type: 'true_false', stem: 'XLOOKUP can return multiple columns in a single formula in Microsoft 365.', options: [{ id: 't', text: 'True', correct: true }, { id: 'f', text: 'False', correct: false }], points: 1, difficulty: 'medium', tags: ['lookups'] },
      { id: 'QQ-3', bankId: 'QB-EXCEL', courseId: 'C-EXCEL', type: 'short', stem: 'Name one Power Query step you would use to split a “City, Country” column into two columns.', modelAnswer: 'Split Column by Delimiter (comma)', keywords: ['split', 'delimiter'], points: 2, difficulty: 'medium', tags: ['power-query'] }
    ],
    quizzes: [
      { id: 'QZ-EX-1', courseId: 'C-EXCEL', batchId: 'B-EX-1', sessionId: 'S-EX-2', title: 'Module 1 check-in', description: 'Short graded check on tables and lookups.', questionIds: ['QQ-1', 'QQ-2', 'QQ-3'], timeLimitSec: 0, attemptLimit: 2, shuffle: false, status: 'published', passPercent: 50 }
    ],
    quizAttempts: [],
    practiceAttempts: [],
    rubrics: [],
    atRiskFlags: [],
    settings: {}
  };
})();
