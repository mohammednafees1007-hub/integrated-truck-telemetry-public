// An independent loopback-only static tutorial. It has no device credentials or receiver routes.
const express=require('express'),path=require('node:path');
const app=express(),base='/truck-tracking',root=path.resolve(__dirname,'../output/synthetic-dist');
app.disable('x-powered-by');
app.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});next()});
app.get('/health',(_req,res)=>res.json({mode:'synthetic',hardware_access:false,port:3001}));
app.use((req,res,next)=>{if(req.path.includes('/api/')||req.path.includes('/pi-gps/'))return res.status(404).json({error:'Synthetic demo has no receiving API or pairing',mode:'synthetic'});next()});
app.get('/',(_req,res)=>res.redirect(base+'/'));
app.use(base+'/recordings',express.static(path.resolve(__dirname,'../output/demo-recordings'),{index:false,dotfiles:'deny'}));
app.use(base,express.static(root,{index:false,dotfiles:'deny'}));
app.get([base,base+'/'],(_req,res)=>res.sendFile(path.join(root,'index.html')));
app.use((_req,res)=>res.status(404).send('Not found'));
app.listen(3001,'127.0.0.1',()=>console.log('Synthetic demonstration: http://localhost:3001/truck-tracking/'));
