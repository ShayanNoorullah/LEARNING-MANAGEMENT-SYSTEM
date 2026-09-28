
const SEED={
users:[
{id:'u-admin',role:'admin',email:'admin@ead.edu',password:'admin123',name:'Ayesha Khan',status:'Active',department:'Administration'},
{id:'u-teacher',role:'teacher',email:'teacher@ead.edu',password:'teacher123',name:'Dr. Hamza Ali',status:'Active',department:'Computer Science',teacherId:'T-1001'},
{id:'u-student',role:'student',email:'student@ead.edu',password:'student123',name:'Arsh Asif',status:'Active',studentId:'ST-1001',department:'Computer Science',program:'BS Computer Science',semester:4,section:'A'}
],
students:[
{id:'ST-1001',name:'Arsh Asif',father:'Asif Ahmed',email:'student@ead.edu',phone:'03001234567',dob:'2009-04-12',gender:'Male',cnic:'B-12345',address:'Karachi',department:'Computer Science',program:'BS Computer Science',semester:4,section:'A',admissionDate:'2024-09-01',username:'student@ead.edu',password:'student123',status:'Active'},
{id:'ST-1002',name:'Maha Noor',father:'Nadeem Noor',email:'maha@ead.edu',phone:'03011234567',dob:'2005-08-21',gender:'Female',address:'Karachi',department:'Software Engineering',program:'BS Software Engineering',semester:4,section:'A',admissionDate:'2024-09-01',username:'maha@ead.edu',password:'student123',status:'Active'},
{id:'ST-1003',name:'Saad Raza',father:'Raza Ahmed',email:'saad@ead.edu',phone:'03021234567',dob:'2005-01-16',gender:'Male',address:'Hyderabad',department:'Artificial Intelligence',program:'BS Artificial Intelligence',semester:2,section:'B',admissionDate:'2025-09-01',username:'saad@ead.edu',password:'student123',status:'Active'},
{id:'ST-1004',name:'Hiba Fatima',father:'Ali Fatima',email:'hiba@ead.edu',phone:'03031234567',dob:'2004-12-05',gender:'Female',address:'Karachi',department:'Business Administration',program:'BBA',semester:6,section:'A',admissionDate:'2023-09-01',username:'hiba@ead.edu',password:'student123',status:'Active'}
],
teachers:[
{id:'T-1001',name:'Dr. Hamza Ali',email:'teacher@ead.edu',phone:'03009998877',department:'Computer Science',designation:'Assistant Professor',qualification:'PhD Computer Science',specialization:'Web Engineering',subjects:['CS-201','CS-102'],joiningDate:'2022-08-15',office:'B-204',username:'teacher@ead.edu',password:'teacher123',status:'Active'},
{id:'T-1002',name:'Ms. Sana Iqbal',email:'sana@ead.edu',phone:'03008887766',department:'Software Engineering',designation:'Lecturer',qualification:'MS Software Engineering',specialization:'Software Quality',subjects:['SE-301'],joiningDate:'2023-01-10',office:'C-103',username:'sana@ead.edu',password:'teacher123',status:'Active'},
{id:'T-1003',name:'Dr. Bilal Shah',email:'bilal@ead.edu',phone:'03007776655',department:'Artificial Intelligence',designation:'Professor',qualification:'PhD AI',specialization:'Machine Learning',subjects:['AI-401'],joiningDate:'2021-09-20',office:'D-201',username:'bilal@ead.edu',password:'teacher123',status:'Active'}
],
departments:[
{id:'D-01',name:'Computer Science',code:'CS',head:'Dr. Hamza Ali',description:'Computing and software systems',office:'Block B',email:'cs@ead.edu',phone:'021-111-000',status:'Active'},
{id:'D-02',name:'Software Engineering',code:'SE',head:'Ms. Sana Iqbal',description:'Software development and quality',office:'Block C',email:'se@ead.edu',phone:'021-111-001',status:'Active'},
{id:'D-03',name:'Artificial Intelligence',code:'AI',head:'Dr. Bilal Shah',description:'AI, data and machine learning',office:'Block D',email:'ai@ead.edu',phone:'021-111-002',status:'Active'},
{id:'D-04',name:'Business Administration',code:'BBA',head:'Dr. Farah Malik',description:'Business and management studies',office:'Block A',email:'bba@ead.edu',phone:'021-111-003',status:'Active'}
],
programs:[
{id:'P-01',name:'BS Computer Science',code:'BSCS',department:'Computer Science',duration:'4 Years',semesters:8,credits:132,coordinator:'Dr. Hamza Ali',description:'Comprehensive computing degree',status:'Active'},
{id:'P-02',name:'BS Software Engineering',code:'BSSE',department:'Software Engineering',duration:'4 Years',semesters:8,credits:132,coordinator:'Ms. Sana Iqbal',description:'Software engineering practice',status:'Active'},
{id:'P-03',name:'BS Artificial Intelligence',code:'BSAI',department:'Artificial Intelligence',duration:'4 Years',semesters:8,credits:132,coordinator:'Dr. Bilal Shah',description:'AI and machine learning',status:'Active'},
{id:'P-04',name:'BBA',code:'BBA',department:'Business Administration',duration:'4 Years',semesters:8,credits:126,coordinator:'Dr. Farah Malik',description:'Business administration',status:'Active'}
],
subjects:[
{id:'CS-101',code:'CS-101',name:'Programming Fundamentals',credits:3,department:'Computer Science',program:'BS Computer Science',semester:1,teacher:'T-1001',description:'Programming foundations',type:'Core',status:'Active'},
{id:'CS-102',code:'CS-102',name:'Database Systems',credits:3,department:'Computer Science',program:'BS Computer Science',semester:4,teacher:'T-1001',description:'Relational databases and SQL',type:'Core',status:'Active'},
{id:'CS-201',code:'CS-201',name:'Web Development',credits:3,department:'Computer Science',program:'BS Computer Science',semester:4,teacher:'T-1001',description:'Modern web engineering',type:'Core',status:'Active'},
{id:'SE-301',code:'SE-301',name:'Software Engineering',credits:3,department:'Software Engineering',program:'BS Software Engineering',semester:4,teacher:'T-1002',description:'Software process and design',type:'Core',status:'Active'},
{id:'AI-401',code:'AI-401',name:'Artificial Intelligence',credits:3,department:'Artificial Intelligence',program:'BS Artificial Intelligence',semester:2,teacher:'T-1003',description:'AI concepts and applications',type:'Core',status:'Active'}
],
classes:[
{id:'CL-01',name:'Web Development - A',program:'BS Computer Science',semester:4,section:'A',subject:'CS-201',teacher:'T-1001',room:'Lab 2',capacity:35,year:'2026',start:'2026-01-15',end:'2026-06-15',status:'Active',students:['ST-1001']},
{id:'CL-02',name:'Database Systems - A',program:'BS Computer Science',semester:4,section:'A',subject:'CS-102',teacher:'T-1001',room:'B-204',capacity:35,year:'2026',start:'2026-01-15',end:'2026-06-15',status:'Active',students:['ST-1001']},
{id:'CL-03',name:'Software Engineering - A',program:'BS Software Engineering',semester:4,section:'A',subject:'SE-301',teacher:'T-1002',room:'C-103',capacity:35,year:'2026',start:'2026-01-15',end:'2026-06-15',status:'Active',students:['ST-1002']}
],
timetable:[
{id:'TT-01',day:'Monday',start:'09:00',end:'10:30',subject:'CS-201',teacher:'T-1001',room:'Lab 2',section:'A',program:'BS Computer Science',semester:4,class:'CL-01'},
{id:'TT-02',day:'Monday',start:'11:00',end:'12:30',subject:'CS-102',teacher:'T-1001',room:'B-204',section:'A',program:'BS Computer Science',semester:4,class:'CL-02'},
{id:'TT-03',day:'Wednesday',start:'09:00',end:'10:30',subject:'CS-201',teacher:'T-1001',room:'Lab 2',section:'A',program:'BS Computer Science',semester:4,class:'CL-01'},
{id:'TT-04',day:'Tuesday',start:'10:00',end:'11:30',subject:'SE-301',teacher:'T-1002',room:'C-103',section:'A',program:'BS Software Engineering',semester:4,class:'CL-03'},
{id:'TT-05',day:'Thursday',start:'10:00',end:'11:30',subject:'AI-401',teacher:'T-1003',room:'D-201',section:'B',program:'BS Artificial Intelligence',semester:2,class:'CL-04'}
],
attendance:[
{id:'AT-01',student:'ST-1001',subject:'CS-201',class:'CL-01',teacher:'T-1001',date:'2026-08-20',status:'Present',notes:''},
{id:'AT-02',student:'ST-1001',subject:'CS-201',class:'CL-01',teacher:'T-1001',date:'2026-08-18',status:'Present',notes:''},
{id:'AT-03',student:'ST-1001',subject:'CS-201',class:'CL-01',teacher:'T-1001',date:'2026-08-17',status:'Absent',notes:'Medical'},
{id:'AT-04',student:'ST-1001',subject:'CS-102',class:'CL-02',teacher:'T-1001',date:'2026-08-19',status:'Present',notes:''},
{id:'AT-05',student:'ST-1001',subject:'CS-102',class:'CL-02',teacher:'T-1001',date:'2026-08-17',status:'Present',notes:''},
{id:'AT-06',student:'ST-1002',subject:'SE-301',class:'CL-03',teacher:'T-1002',date:'2026-08-20',status:'Present',notes:''}
],
assignments:[
{id:'AS-01',subject:'CS-201',class:'CL-01',program:'BS Computer Science',semester:4,title:'Responsive University Website',description:'Build a responsive university portal using HTML, CSS and JavaScript.',instructions:'Use semantic HTML, responsive CSS and accessible interactions.',dueDate:'2026-09-15',dueTime:'23:59',marks:20,submissionType:'File and text',lateAllowed:true,status:'Published',teacher:'T-1001',created:'2026-08-25'},
{id:'AS-02',subject:'CS-102',class:'CL-02',program:'BS Computer Science',semester:4,title:'SQL Schema Design',description:'Design a normalized relational schema.',instructions:'Submit ERD and SQL script.',dueDate:'2026-09-10',dueTime:'23:59',marks:20,submissionType:'File upload',lateAllowed:false,status:'Published',teacher:'T-1001',created:'2026-08-24'},
{id:'AS-03',subject:'SE-301',class:'CL-03',program:'BS Software Engineering',semester:4,title:'SRS Mini Project',description:'Prepare a software requirements specification.',instructions:'Include functional and non-functional requirements.',dueDate:'2026-09-12',dueTime:'23:59',marks:25,submissionType:'File and text',lateAllowed:true,status:'Published',teacher:'T-1002',created:'2026-08-23'}
],
submissions:[
{id:'SUB-01',assignment:'AS-01',student:'ST-1001',date:'2026-08-30T18:30',status:'Submitted',fileName:'university-homepage.zip',text:'Completed responsive homepage.',link:'',marks:null,feedback:'',reviewed:false},
{id:'SUB-02',assignment:'AS-02',student:'ST-1001',date:'2026-08-29T16:20',status:'Graded',fileName:'schema.sql',text:'Normalized schema and SQL.',link:'',marks:18,feedback:'Strong normalization. Add more constraints.',reviewed:true}
],
exams:[
{id:'EX-01',name:'Web Development Midterm',subject:'CS-201',date:'2026-09-20',start:'10:00',end:'12:00',room:'Main Hall',class:'CL-01',program:'BS Computer Science',semester:4,total:50,instructions:'Bring university ID.',status:'Scheduled'},
{id:'EX-02',name:'Database Systems Final',subject:'CS-102',date:'2026-10-05',start:'09:00',end:'12:00',room:'Main Hall',class:'CL-02',program:'BS Computer Science',semester:4,total:100,instructions:'SQL and theory.',status:'Scheduled'},
{id:'EX-03',name:'Software Engineering Midterm',subject:'SE-301',date:'2026-09-22',start:'10:00',end:'12:00',room:'Hall C',class:'CL-03',program:'BS Software Engineering',semester:4,total:50,instructions:'Case-study based.',status:'Scheduled'}
],
results:[
{id:'R-01',student:'ST-1001',subject:'CS-201',class:'CL-01',semester:4,quiz:9,assignment:18,midterm:22,final:0,total:49,percentage:98,grade:'A+',gpa:4.0,remarks:'Excellent',published:true,date:'2026-08-28'},
{id:'R-02',student:'ST-1001',subject:'CS-102',class:'CL-02',semester:4,quiz:8,assignment:18,midterm:20,final:0,total:46,percentage:92,grade:'A+',gpa:4.0,remarks:'Very strong',published:true,date:'2026-08-28'},
{id:'R-03',student:'ST-1002',subject:'SE-301',class:'CL-03',semester:4,quiz:7,assignment:17,midterm:19,final:0,total:43,percentage:86,grade:'A',gpa:4.0,remarks:'Good progress',published:true,date:'2026-08-27'}
],
fees:[
{id:'F-01',student:'ST-1001',program:'BS Computer Science',semester:4,type:'Tuition Fee',amount:85000,dueDate:'2026-09-10',status:'Pending',paymentDate:'',method:'',transaction:'',remarks:'Fall semester'},
{id:'F-02',student:'ST-1001',program:'BS Computer Science',semester:4,type:'Library Fee',amount:3000,dueDate:'2026-08-01',status:'Paid',paymentDate:'2026-07-30',method:'Bank Transfer',transaction:'TXN-1022',remarks:''},
{id:'F-03',student:'ST-1002',program:'BS Software Engineering',semester:4,type:'Tuition Fee',amount:82000,dueDate:'2026-09-10',status:'Pending',paymentDate:'',method:'',transaction:'',remarks:'Fall semester'}
],
announcements:[
{id:'AN-01',title:'Fall Semester Academic Calendar',message:'The Fall 2026 academic calendar is now available.',audience:'All Students',program:'',class:'',date:'2026-08-25',expiry:'2026-12-31',priority:'Important',status:'Published',pinned:true},
{id:'AN-02',title:'Web Development Lab Schedule',message:'Lab sessions for CS-201 will take place in Lab 2.',audience:'Specific Class',program:'BS Computer Science',class:'CL-01',date:'2026-08-27',expiry:'2026-09-30',priority:'Normal',status:'Published',pinned:false}
],
messages:[
{id:'M-01',from:'u-teacher',to:'u-student',subject:'Assignment feedback',body:'Please review the feedback on your SQL assignment.',date:'2026-08-30T14:20',read:false},
{id:'M-02',from:'u-student',to:'u-teacher',subject:'Question about Web Development',body:'Could you clarify the responsive layout requirement?',date:'2026-08-29T12:10',read:true}
],
materials:[],notifications:[
{id:'N-01',user:'u-student',type:'New Assignment',title:'New assignment: Responsive University Website',message:'A new CS-201 assignment is available.',date:'2026-08-25T09:00',read:false},
{id:'N-02',user:'u-student',type:'Fee Due',title:'Tuition fee due soon',message:'Your tuition fee is due on 10 September 2026.',date:'2026-08-31T08:00',read:false},
{id:'N-03',user:'u-student',type:'Result Published',title:'Result published',message:'Your CS-102 result is available.',date:'2026-08-28T12:00',read:true}
],
settings:{university:'EAD UNIVERSITY',academicYear:'2026',semester:'Fall 2026',attendanceWarning:75,lateSubmission:true,pageSize:8,searchEnabled:true,filtersEnabled:true,defaultView:'board',passkeyEnabled:true}
};
