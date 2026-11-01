*
*Zetex ZVP1320F Spice Model v1.0 Last Revised 13/06/02
*
.SUBCKT ZVP1320F 3 4 5
*                D G S
M1 6 2 8 8 MOSMOD
M2 6 2 8 8 MOSMODS
RG 4 2 56
RIN 2 8 200E6
RD 3 6 RDSMOD 71
RS 8 5 RDSMOD 6.6 
RL 3 5 200E6
C1 2 8 42E-12
D1 3 5 DMOD1
D2 3 17 DMOD2
Egs1 2 17 2 8 1
.MODEL MOSMOD PMOS VTO=-2.56 IS=1E-15 KP=.059 CBD=15E-12 PB=1 LAMBDA=4.9E-3
.MODEL MOSMODS PMOS VTO=-2.2 IS=1E-15 KP=0.002 PB=1
.MODEL DMOD1 D IS=2E-13 RS=0.12 N=1.01 IKF=3e-3
.MODEL DMOD2 D CJO=18e-12 IS=1e-30 N=10
.MODEL RDSMOD RES (TC1=8E-3 TC2=3E-5)
.ENDS ZVP1320F
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
