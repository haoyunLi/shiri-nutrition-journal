"use client";
import {useEffect} from 'react';
export default function Page(){useEffect(()=>{const script=document.createElement('script');script.type='module';script.src='/app.js';document.body.appendChild(script);return()=>{script.remove();};},[]);return <div id="app"><main><h1>食日</h1><p role="status">正在读取私人日记…</p></main></div>;}
