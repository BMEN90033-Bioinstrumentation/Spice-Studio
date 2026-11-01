*
*ZETEX ZXMN2A03E6 Spice Model v1.0 Last Revised 11/08/05
*
.SUBCKT ZXMN2A03E6 30 40 50
*------connections-------D-G-S
M1 6 20 5 5 Nmod 
M2 5 20 5 6 Pmod 
RG 4 2 1
RIN 2 5 1E12
RD 3 6 Rmod1 0.04
RL 3 5 3E9
C1 2 5 1.5E-10
C2 3 4 2.5E-10
D1 5 3  Dbodymod
Egt1 2 20 21 5 1
Vgt1 5 22 1
Igt1 5 21 1
Rgt 21 22 Rmod2 1.45
LD 3 30 0.3E-9
LG 4 40 1.9E-9
LS 5 50 1.9E-9
.MODEL Nmod NMOS (LEVEL=3 L=0.7E-6 W=0.77 TOX=45E-9 NSUB=4.09E16 UO=929)
+VTO=0.9 KP=34E-6 GAMMA=1.52 PHI=0.77 RS=0.02 KAPPA=0.01)
.MODEL Pmod PMOS (LEVEL=3 L=0.6E-6 W=0.8 TOX=70E-9 NSUB=4.09E16 UO=373)
.MODEL Dbodymod D (IS=2E-11 N=1 IKF=3 RS=0.05 TRS1=1E-5 TRS2=3E-5 XTI=0.1)
.MODEL Rmod1 RES (TC1=0 TC2=0)
.MODEL Rmod2 RES (TC1=3E-4 TC2=1E-7)
.ENDS ZXMN2A03E6
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
