*
*Zetex ZVN3310A Spice Model v1.1 Last Revised 3/5/00
*              
.SUBCKT ZVN3310A 3 4 5
* NODES: DRAIN GATE SOURCE
M1 3 2 5 5 MOD1   
RG 4 2 356
RL 3 5 1E8
C1 2 5 21.5P
C2 3 2 2.5P 
D1 5 3 DIODE1
*
.MODEL MOD1 NMOS VTO=1.736 RS=2.147 RD=1.682 IS=1E-15 KP=0.157
+CBD=25.5P PB=1
.MODEL DIODE1 D IS=6.12E-13 RS=.629
.ENDS ZVN3310A
*
*$
*
*                (c)  2005 Zetex Semiconductors plc
*
*   The copyright in these models  and  the designs embodied belong
*   to Zetex Semiconductors plc (" Zetex ").  They  are  supplied
*   free of charge by Zetex for the purpose of research and design
*   and may be used or copied intact  (including this notice)  for
*   that purpose only.  All other rights are reserved. The models
*   are believed accurate but  no condition  or warranty  as to their
*   merchantability or fitness for purpose is given and no liability
*   in respect of any use is accepted by Zetex PLC, its distributors
*   or agents.
*
*   Zetex Semiconductors plc, Zetex Technology Park, Chadderton,
*   Oldham, United Kingdom, OL9 9LL
