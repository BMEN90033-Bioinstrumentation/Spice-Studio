*
*Zetex ZVP2106G Spice Model v1.1 Last Revised 3/5/00
*
.SUBCKT ZVP2106G 3 4 5
*                D G S
M1 3 2 5 5 MP2106
RG 4 2 160
RL 3 5 1.2E8
C1 2 5 47E-12
C2 3 2 10E-12 
D1 3 5 DP2106
*
.MODEL MP2106 PMOS VTO=-3.193 RS=2.041 RD=0.697 IS=1E-15 KP=0.277
+CBD=105E-12 PB=1 LAMBDA=1.2E-2
.MODEL DP2106 D IS=2E-13 RS=0.309
.ENDS ZVP2106G
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
