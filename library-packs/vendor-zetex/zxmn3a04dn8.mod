*
*Zetex ZXMN3A04DN8 Spice Model v2.0 Last Revised 15/03/07
*
.SUBCKT ZXMN3A04DN8 30 40 50
*------connections-------D-G-S
M1 6 20 5 5 Nmod 
M2 5 20 5 6 Pmod 
RG 4 2 1.0
RIN 2 5 1E12
RD 3 6 Rmod1 0.01
RL 3 5 1E8
C1 2 5 6.2E-10
C2 3 4 1.5E-10
D1 5 3  Dbodymod
Egt1 2 20 21 5 1.0
Vgt1 5 22 1.0
Igt1 5 21 1.0
Rgt 21 22 Rmod2 2.3
LD 3 30 1.5E-9
LG 4 40 1.2E-9
LS 5 50 1.2E-9
.MODEL Nmod NMOS (LEVEL=3 L=0.7E-6 W=2.183 TOX=64E-9 NSUB=3.07E16 
+UO=389 RS=0.02 XJ=1.6e-6)
.MODEL Pmod PMOS (LEVEL=3 L=1.2E-6 W=2.183 TOX=64E-9 NSUB=1.07E16 
+UO=429  TPG=-1)
.MODEL Dbodymod D (IS=6E-10 N=1.2 RS=0.03 IKF=1 TIKF=2 TRS1=4E-4 
+XTI=0.1)
.MODEL Rmod1 RES (TC1=1E-4 TC2=1E-6)
.MODEL Rmod2 RES (TC1=-3E-4 TC2=-5E-6)
.ENDS ZXMN3A04DN8
*
*$
*
*                (c)  2007 Zetex Semiconductors plc
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
