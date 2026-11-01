*
*Zetex ZVN4210A Spice Model v1.1 Last Revised 3/5/00
*
.SUBCKT ZVN4210A 3 4 5
* Nodes          D G S
M1 3 2 5 5 MOD1
RG 4 2 401.5
RL 3 5 1E7
C1 2 5 61.5P
C2 3 2 3.5P 
D1 5 3 DIODE1
*
.MODEL MOD1 NMOS VTO=1.922 RS=0.858 RD=0.2025 IS=1E-15 KP=2.082
+CBD=108P PB=1 LAMBDA=0
.MODEL DIODE1 D IS=1.10461E-12 N=1.0114 RS=0.166
.ENDS ZVN4210A
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
