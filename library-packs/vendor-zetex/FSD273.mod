*
*ZETEX  FSD273  Spice Model        Last revision 15/4/2004
*
.MODEL FSD273 D IS=1.5E-15 N=1 RS=0.16 CJO=73E-12 M=1.4 VJ=2
+BV=25 IBV=1E-3 ISR=1.8E-12 NR=1.55 TT=23E-9 
*
*NOTES:
*This single diode model is one half of a common cathode pair.
*For RF operation add SOT323 package inductance of 1E-9H in 
*series with each diode.
*This model is typical at 50MHz and below.  At higher frequency 
*add an additional 0.05ohm series resistance per octave.
*
*$
*
*                          (C)  2004 ZETEX PLC
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
