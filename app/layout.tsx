import type {Metadata} from 'next';
export const metadata:Metadata={title:'食日 · 私人饮食与体重记录',robots:{index:false,follow:false},description:'私人饮食、体重与估算依据记录'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/journal.css"/></head><body>{children}</body></html>;}
