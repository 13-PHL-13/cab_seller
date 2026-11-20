import approvedLogo from '@/assets/brand-logo-approved.png';

/** The approved original artwork, with only its surrounding white space clipped. */
export function BrandLogo({width=208}:{width?:number}){
 return <img src={approvedLogo} alt="Навигатор продаж" width={width} height={Math.round(width/4.35)} style={{display:'block',width,maxWidth:'100%',height:Math.round(width/4.35),objectFit:'cover',objectPosition:'center',borderRadius:5,background:'#fff'}}/>;
}
