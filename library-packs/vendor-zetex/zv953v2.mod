*
*ZETEX  ZV953V2  Spice Model        Last revision 2/5/2002
*
.MODEL ZV953V2 D IS=1.5E-15 N=1 RS=0.2 CJO=73E-12 M=1.4 VJ=2
+BV=25 IBV=1E-3 ISR=1.8E-12 NR=1.55 TT=17E-9 
*
*NOTES: 
*For RF operation add SOD523 package inductance of 0.6E-9H in 
*series with diode.
*This model is typical at 50MHz and below.  At higher frequency 
*add an additional 0.09ohm series resistance per octave.
*
*$
*
*                          (C)  2002 ZETEX PLC
*
*   The copyright in this model  and  the design embodied belong to
*   Zetex PLC ("Zetex"). It is supplied free of charge by Zetex for
*   the purpose  of research  and design  and may be used or copied
*   intact (including this notice) for that purpose only. All other
*   rights  are  reserved.  The model  is believed  accurate but no
*   condition or warranty as to its  merchantability or fitness for
*   purpose  is  given  and  no liability  in respect of any use is
*   accepted by Zetex PLC, its distributors or agents.
*
*
*   Zetex PLC, Fields New Road, Chadderton, Oldham OL9 8NP, UK
