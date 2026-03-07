/**
 * Bundled by jsDelivr using Rollup v2.79.2 and Terser v5.39.0.
 * Original file: /npm/@codemirror/lang-json@6.0.1/dist/index.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
import{parser as e}from"/npm/@lezer/json@1.0.0/+esm";import{LRLanguage as t,indentNodeProp as r,continuedIndent as n,foldNodeProp as a,foldInside as o,LanguageSupport as s}from"/npm/@codemirror/language@6.3.0/+esm";const c=()=>e=>{try{JSON.parse(e.state.doc.toString())}catch(t){if(!(t instanceof SyntaxError))throw t;const r=function(e,t){let r;return(r=e.message.match(/at position (\d+)/))?Math.min(+r[1],t.length):(r=e.message.match(/at line (\d+) column (\d+)/))?Math.min(t.line(+r[1]).from+ +r[2]-1,t.length):0}(t,e.state.doc);return[{from:r,message:t.message,severity:"error",to:r}]}return[]};const m=t.define({name:"json",parser:e.configure({props:[r.add({Object:n({except:/^\s*\}/}),Array:n({except:/^\s*\]/})}),a.add({"Object Array":o})]}),languageData:{closeBrackets:{brackets:["[","{",'"']},indentOnInput:/^\s*[\}\]]$/}});function i(){return new s(m)}export{i as json,m as jsonLanguage,c as jsonParseLinter};export default null;
