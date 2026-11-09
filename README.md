# Clear-Mind-
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clear Mind</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f3f5fa;color:#172b4d;font-family:Arial,sans-serif}
.app{max-width:850px;margin:auto;padding:22px}
header{background:#172b4d;color:white;padding:25px;border-radius:18px;margin-bottom:18px}
h1{margin:0;font-size:29px}
header p{color:#dce5f4}
.stats{display:flex;gap:10px;margin-top:20px}
.stat{background:#ffffff20;padding:12px;border-radius:12px;flex:1}
.stat strong{display:block;font-size:23px}
.panel{background:white;border-radius:16px;padding:19px;margin:15px 0;box-shadow:0 5px 20px #172b4d0b}
h2{font-size:19px;margin:0 0 12px}
input,select,textarea{width:100%;padding:12px;border:1px solid #dce2ed;border-radius:9px;margin:5px 0;font:inherit}
textarea{min-height:85px;resize:vertical}
button{border:0;border-radius:9px;padding:11px 15px;background:#4263eb;color:white;font-weight:bold;cursor:pointer;margin-top:6px}
button.secondary{background:#eaf0ff;color:#4263eb}
button.delete{background:transparent;color:#c44;padding:5px}
.task{display:flex;gap:10px;align-items:center;border:1px solid #e5eaf2;padding:12px;border-radius:11px;margin:9px 0}
.task span{flex:1;overflow-wrap:anywhere}
.task.done span{text-decoration:line-through;color:#999}
.small{font-size:12px;color:#718096}
.row{display:flex;gap:9px}
.row>*{flex:1;min-width:0}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.filters button{font-size:12px}
.filters button.active{background:#172b4d}
.pill{font-size:11px;color:#667085;background:#edf1f6;padding:4px 8px;border-radius:20px}
.empty{padding:18px;color:#8994a5;text-align:center}
.plan{padding:10px 0;border-bottom:1px solid #eee}
@media(max-width:500px){.app{padding:12px}.stats{gap:6px}.stat{padding:9px}.stat strong{font-size:19px}.row{gap:5px}}
</style>
</head>
<body>
<div class="app">
<header>
<h1>✦ Clear Mind</h1>
<p>A little more space in your head. One thing at a time.</p>
<div class="stats">
<div class="stat"><strong id="openCount">0</strong><span>To do</span></div>
<div class="stat"><strong id="doneCount">0</strong><span>Completed</span></div>
<div class="stat"><strong id="thoughtCount">0</strong><span>Brain dump</span></div>
</div>
</header>

<section class="panel">
<h2>🧠 Brain Dump</h2>
<p class="small">Get everything out of your head. You can turn thoughts into tasks later.</p>
<textarea id="thought" placeholder="What's on your mind?"></textarea>
<button onclick="addThought()">Save thought</button>
<div id="thoughts"></div>
</section>

<section class="panel">
<h2>＋ Add a Task</h2>
<input id="taskName" placeholder="What needs to get done?">
<div class="row">
<select id="priority">
<option value="High">High priority</option>
<option value="Medium" selected>Medium priority</option>
<option value="Low">Low priority</option>
</select>
<select id="category">
<option>Personal</option>
<option>Work</option>
<option>Home</option>
<option>Family</option>
<option>Errands</option>
<option>Other</option>
</select>
</div>
<label class="small">Due date (optional)</label>
<input id="due" type="date">
<button onclick="addTask()">Add Task</button>
</section>

<section class="panel">
<h2>✓ My Tasks</h2>
<div class="filters">
<button class="active" onclick="setFilter('All',this)">All</button>
<button class="secondary" onclick="setFilter('Open',this)">To do</button>
<button class="secondary" onclick="setFilter('Done',this)">Completed</button>
</div>
<div id="tasks"></div>
</section>

<section class="panel">
<h2>🗓️ My Day Plan</h2>
<div class="row">
<input type="time" id="planTime">
<input id="planName" placeholder="What will you work on?">
</div>
<button onclick="addPlan()">Add to day</button>
<div id="plans"></div>
</section>

<section class="panel">
<h2>🌱 Progress</h2>
<div style="background:#e8edf4;height:12px;border-radius:20px;overflow:hidden">
<div id="bar" style="height:100%;width:0;background:#16865b"></div>
</div>
<p id="progress" class="small">Start with one small thing.</p>
<button class="secondary" onclick="clearDone()">Clear completed tasks</button>
</section>

<p class="small" style="text-align:center">Clear Mind — Your progress counts, even when it's one small step.</p>
</div>

<script>
let tasks=JSON.parse(localStorage.getItem('cm_tasks')||'[]');
let thoughts=JSON.parse(localStorage.getItem('cm_thoughts')||'[]');
let plans=JSON.parse(localStorage.getItem('cm_plans')||'[]');
let filter='All';

function save(){
localStorage.setItem('cm_tasks',JSON.stringify(tasks));
localStorage.setItem('cm_thoughts',JSON.stringify(thoughts));
localStorage.setItem('cm_plans',JSON.stringify(plans));
render();
}
function addTask(){
let name=document.getElementById('taskName').value.trim();
if(!name)return alert('Enter a task first.');
tasks.push({id:Date.now(),name,priority:priority.value,category:category.value,due:due.value,done:false});
taskName.value='';due.value='';save();
}
function addThought(){
let value=thought.value.trim();
if(!value)return;
thoughts.push({id:Date.now(),text:value});
thought.value='';save();
}
function makeTask(id){
let t=thoughts.find(x=>x.id===id);
if(!t)return;
tasks.push({id:Date.now(),name:t.text,priority:'Medium',category:'Personal',due:'',done:false});
thoughts=thoughts.filter(x=>x.id!==id);save();
}
function addPlan(){
let time=planTime.value,name=planName.value.trim();
if(!time||!name)return alert('Add a time and activity.');
plans.push({id:Date.now(),time,name});planName.value='';save();
}
function setFilter(value,button){
filter=value;
document.querySelectorAll('.filters button').forEach(b=>b.classList.remove('active'));
button.classList.add('active');render();
}
function toggle(id){
let t=tasks.find(x=>x.id===id);if(t)t.done=!t.done;save();
}
function removeTask(id){
if(confirm('Delete this task?')){tasks=tasks.filter(x=>x.id!==id);save();}
}
function clearDone(){
if(confirm('Clear all completed tasks?')){tasks=tasks.filter(x=>!x.done);save();}
}
function render(){
let open=tasks.filter(x=>!x.done).length;
let done=tasks.filter(x=>x.done).length;
openCount.textContent=open;doneCount.textContent=done;thoughtCount.textContent=thoughts.length;
let pct=tasks.length?Math.round(done/tasks.length*100):0;
bar.style.width=pct+'%';
progress.textContent=tasks.length?done+' of '+tasks.length+' tasks completed ('+pct+'%).':'Start with one small thing.';
let visible=tasks.filter(t=>filter==='All'||(filter==='Open'&&!t.done)||(filter==='Done'&&t.done));
tasksDiv=document.getElementById('tasks');
tasksDiv.innerHTML=visible.length?visible.map(t=>`
<div class="task ${t.done?'done':''}">
<button class="secondary" onclick="toggle(${t.id})">${t.done?'✓':'○'}</button>
<span><b>${escapeHTML(t.name)}</b><br><small class="small">${t.priority} · ${escapeHTML(t.category)} ${t.due?'· Due '+t.due:''}</small></span>
<button class="delete" onclick="removeTask(${t.id})">✕</button>
</div>`).join(''):'<div class="empty">Nothing here right now. Take a breath.</div>';
document.getElementById('thoughts').innerHTML=thoughts.map(t=>`
<div class="task"><span>${escapeHTML(t.text)}</span>
<button class="secondary" onclick="makeTask(${t.id})">Make task</button>
<button class="delete" onclick="deleteThought(${t.id})">✕</button></div>`).join('');
document.getElementById('plans').innerHTML=plans.sort((a,b)=>a.time.localeCompare(b.time)).map(p=>`
<div class="plan"><b>${p.time}</b> — ${escapeHTML(p.name)}
<button class="delete" onclick="deletePlan(${p.id})">✕</button></div>`).join('')||'<div class="empty">Your plan will appear here.</div>';
}
function deleteThought(id){thoughts=thoughts.filter(x=>x.id!==id);save();}
function deletePlan(id){plans=plans.filter(x=>x.id!==id);save();}
function escapeHTML(s){
return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
render();
</script>
</body>
</html>
