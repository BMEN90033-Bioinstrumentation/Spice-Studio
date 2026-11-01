*
*ZETEX BSS123A Spice model v2.0 Last Revision 29/12/06
*
.SUBCKT BSS123A 3 4 5
* NODES: DRAIN GATE SOURCE
M1 13 2 8 8 MOD1   
RG 4 2 30
RL 3 5 1E8
RS 5 8 RMOD1 2.147
RD 3 13 RMOD1 1.682
C1 2 8 40P
D1 5 3 DMOD1
D2 17 3 DMOD2
Egs1 2 17 2 8 1
.MODEL MOD1 NMOS VTO=1.2  IS=1E-15 KP=0.157 CBD=25.5P PB=1
.MODEL DMOD1 D IS=6.12E-13 RS=.629
.MODEL DMOD2 D CJO=60e-12 IS=1e-30 N=10
.MODEL RMOD1 RES (TC1=7.5E-3 TC2=2.5E-5)
.ENDS BSS123A
*
*$
*
*                (c)  2006 Zetex Semiconductors plc
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
